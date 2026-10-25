import { describe, expect, it, vi } from 'vitest';
import { buildRun, ev, events } from '../test/factories';
import { DEFAULT_MODEL_CONFIG } from './config';
import type { ModelConfig } from './config';
import { chat, ModelError, probeRuntime } from './ollama';
import type { FetchLike } from './ollama';
import { buildSummaryPrompt } from './prompt';

type Route = (init?: RequestInit) => Response | Promise<Response>;

function mockOllama(routes: Record<string, Route>) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    calls.push({ path: pathname, init });
    const route = routes[pathname];
    if (!route) throw new TypeError('Failed to fetch');
    return route(init);
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TAGS = {
  models: [
    {
      name: 'granite4.2:3b',
      model: 'granite4.2:3b',
      size: 2_200_000_000,
      digest: 'sha256-abc',
      details: { family: 'granite', parameter_size: '3B', quantization_level: 'Q4_K_M' },
    },
    { name: 'gemma4:31b', remote_host: 'https://ollama.com:443', remote_model: 'gemma4:31b' },
    { name: 'llama3.2:latest' },
  ],
};

const CONFIG: ModelConfig = { ...DEFAULT_MODEL_CONFIG, timeoutMs: 1000 };
const PROMPT = buildSummaryPrompt(buildRun(events(ev.user('hello'))), { boundary: 'TRACE_TEST' });

describe('probeRuntime', () => {
  it('reports a ready local model with its details', async () => {
    const { fetchImpl } = mockOllama({
      '/api/version': () => json({ version: '0.20.1' }),
      '/api/tags': () => json(TAGS),
    });
    await expect(probeRuntime(CONFIG, { fetchImpl })).resolves.toEqual({
      state: 'ready',
      version: '0.20.1',
      model: {
        name: 'granite4.2:3b',
        digest: 'sha256-abc',
        parameterSize: '3B',
        quantization: 'Q4_K_M',
        sizeBytes: 2_200_000_000,
      },
    });
  });

  it('never contacts a non-loopback endpoint or uses a cloud model name', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const remote = await probeRuntime({ ...CONFIG, endpoint: 'https://ollama.com' }, { fetchImpl });
    const cloud = await probeRuntime({ ...CONFIG, model: 'gemma4:cloud' }, { fetchImpl });
    expect(remote.state).toBe('blocked');
    expect(cloud.state).toBe('blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a model that Ollama reports as remote', async () => {
    const { fetchImpl } = mockOllama({
      '/api/version': () => json({ version: '0.20.1' }),
      '/api/tags': () => json(TAGS),
    });
    const status = await probeRuntime({ ...CONFIG, model: 'gemma4:31b' }, { fetchImpl });
    expect(status).toEqual({
      state: 'blocked',
      message: expect.stringContaining('https://ollama.com:443'),
    });
  });

  it('lists installed models when the configured one is missing', async () => {
    const { fetchImpl } = mockOllama({
      '/api/version': () => json({ version: '0.20.1' }),
      '/api/tags': () => json(TAGS),
    });
    const status = await probeRuntime({ ...CONFIG, model: 'qwen3.5:4b' }, { fetchImpl });
    expect(status).toMatchObject({
      state: 'model-missing',
      installed: ['granite4.2:3b', 'gemma4:31b', 'llama3.2:latest'],
    });
  });

  it('matches an untagged name to the :latest tag', async () => {
    const { fetchImpl } = mockOllama({
      '/api/version': () => json({ version: '0.20.1' }),
      '/api/tags': () => json(TAGS),
    });
    const status = await probeRuntime({ ...CONFIG, model: 'llama3.2' }, { fetchImpl });
    expect(status.state).toBe('ready');
  });

  it('reports an unreachable runtime instead of throwing', async () => {
    const { fetchImpl } = mockOllama({});
    const status = await probeRuntime(CONFIG, { fetchImpl });
    expect(status).toEqual({
      state: 'unreachable',
      message:
        "Couldn't reach Ollama at http://127.0.0.1:11434. Check that Ollama is installed and running.",
    });
  });
});

describe('chat', () => {
  it('sends the schema-constrained, deterministic, non-thinking request', async () => {
    const { fetchImpl, calls } = mockOllama({
      '/api/chat': () =>
        json({
          model: 'granite4.2:3b',
          message: { role: 'assistant', content: '{"summary":"ok"}' },
          done: true,
          total_duration: 2_500_000_000,
          prompt_eval_count: 900,
          eval_count: 120,
        }),
    });
    const reply = await chat(CONFIG, PROMPT, { fetchImpl });
    expect(reply).toEqual({
      content: '{"summary":"ok"}',
      model: 'granite4.2:3b',
      totalDurationMs: 2500,
      promptTokens: 900,
      outputTokens: 120,
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'granite4.2:3b',
      stream: false,
      think: false,
      options: { temperature: 0, num_ctx: 16_384 },
    });
    expect(body.format).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['claims']),
    });
    expect(body.messages).toEqual([
      { role: 'system', content: PROMPT.system },
      { role: 'user', content: PROMPT.user },
    ]);
  });

  it('retries once without `think` when a model does not support thinking', async () => {
    let attempt = 0;
    const { fetchImpl, calls } = mockOllama({
      '/api/chat': () => {
        attempt += 1;
        return attempt === 1
          ? json({ error: '"llama3.2" does not support thinking' }, 400)
          : json({ message: { content: '{}' }, done: true });
      },
    });
    await chat(CONFIG, PROMPT, { fetchImpl });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]?.init?.body))).not.toHaveProperty('think');
  });

  it('maps HTTP failures to clear error kinds', async () => {
    const missing = mockOllama({ '/api/chat': () => json({ error: 'model not found' }, 404) });
    await expect(chat(CONFIG, PROMPT, missing)).rejects.toMatchObject({ kind: 'model-missing' });
    const broken = mockOllama({ '/api/chat': () => json({ error: 'out of memory' }, 500) });
    await expect(chat(CONFIG, PROMPT, broken)).rejects.toMatchObject({ kind: 'http' });
    const odd = mockOllama({ '/api/chat': () => json({ nothing: true }) });
    await expect(chat(CONFIG, PROMPT, odd)).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('times out and can be cancelled', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    await expect(
      chat({ ...CONFIG, timeoutMs: 20 }, PROMPT, { fetchImpl: hanging }),
    ).rejects.toMatchObject({
      kind: 'timeout',
    });
    const controller = new AbortController();
    const pending = chat(CONFIG, PROMPT, { fetchImpl: hanging, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ModelError);
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('streams the answer and reports progress, even across split chunks', async () => {
    const lines = [
      { message: { content: '{"sum' } },
      { message: { content: 'mary":"ok"}' } },
      { done: true, model: 'granite4.2:3b', total_duration: 1_000_000_000, eval_count: 7 },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('');
    const bytes = new TextEncoder().encode(lines);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 17));
        controller.enqueue(bytes.slice(17));
        controller.close();
      },
    });
    const { fetchImpl, calls } = mockOllama({ '/api/chat': () => new Response(body) });
    const progress: number[] = [];
    const reply = await chat(CONFIG, PROMPT, {
      fetchImpl,
      onProgress: (count) => progress.push(count),
    });
    expect(reply.content).toBe('{"summary":"ok"}');
    expect(reply.totalDurationMs).toBe(1000);
    expect(progress).toEqual([5, 16]);
    expect(JSON.parse(String(calls[0]?.init?.body)).stream).toBe(true);
  });

  it('surfaces errors reported inside the stream', async () => {
    const body = new Response(`${JSON.stringify({ error: 'model crashed' })}\n`);
    const { fetchImpl } = mockOllama({ '/api/chat': () => body });
    await expect(chat(CONFIG, PROMPT, { fetchImpl, onProgress: () => {} })).rejects.toMatchObject({
      kind: 'http',
      message: 'Ollama reported an error: model crashed',
    });
  });
});
