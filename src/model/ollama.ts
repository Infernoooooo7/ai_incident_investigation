/**
 * Minimal client for a local Ollama server (https://docs.ollama.com/api).
 *
 * Every request is checked against the loopback-only endpoint rule, and models
 * that Ollama reports as remote (`remote_host`/`remote_model` in /api/tags) or
 * that carry a cloud tag are refused, so trace data stays on this computer.
 */
import { checkEndpoint, checkModelName, isCloudModelName } from './config';
import type { ModelConfig } from './config';
import { SUMMARY_SCHEMA } from './prompt';
import type { ModelPrompt } from './prompt';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ModelErrorKind =
  'blocked' | 'unreachable' | 'timeout' | 'cancelled' | 'model-missing' | 'http' | 'malformed';

export class ModelError extends Error {
  readonly kind: ModelErrorKind;
  /** The model's raw reply, kept for display when it could not be parsed. */
  readonly raw?: string;

  constructor(kind: ModelErrorKind, message: string, raw?: string) {
    super(message);
    this.name = 'ModelError';
    this.kind = kind;
    this.raw = raw;
  }
}

export interface InstalledModel {
  name: string;
  digest?: string;
  parameterSize?: string;
  quantization?: string;
  sizeBytes?: number;
}

export type RuntimeStatus =
  | { state: 'blocked'; message: string }
  | { state: 'unreachable'; message: string }
  | { state: 'model-missing'; message: string; installed: string[]; version?: string }
  | { state: 'ready'; version?: string; model: InstalledModel };

export interface RequestOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}

export interface ChatOptions extends RequestOptions {
  /** Called as the answer streams in, with the number of characters received so far. */
  onProgress?: (receivedCharacters: number) => void;
}

const PROBE_TIMEOUT_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Runs an operation (request plus reading its body) under one abort scope that
 * combines the caller's signal with a timeout, and maps failures to ModelError.
 */
async function withAbort<T>(
  timeoutMs: number,
  options: RequestOptions,
  operation: (signal: AbortSignal, fetchImpl: FetchLike) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', forward, { once: true });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  try {
    return await operation(controller.signal, fetchImpl);
  } catch (error) {
    if (timedOut) {
      throw new ModelError(
        'timeout',
        `No complete response after ${Math.round(timeoutMs / 1000)} seconds.`,
      );
    }
    if (options.signal?.aborted) throw new ModelError('cancelled', 'The request was cancelled.');
    if (error instanceof ModelError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModelError('unreachable', detail);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forward);
  }
}

function matchesModel(installed: string, wanted: string): boolean {
  return installed === wanted || (!wanted.includes(':') && installed === `${wanted}:latest`);
}

function modelName(entry: Record<string, unknown>): string {
  if (typeof entry.name === 'string') return entry.name;
  return typeof entry.model === 'string' ? entry.model : '';
}

/** Checks the endpoint and model without sending any trace data. */
export async function probeRuntime(
  config: ModelConfig,
  options: RequestOptions = {},
): Promise<RuntimeStatus> {
  const endpoint = checkEndpoint(config.endpoint);
  if (!endpoint.ok) return { state: 'blocked', message: endpoint.reason };
  const model = checkModelName(config.model);
  if (!model.ok) return { state: 'blocked', message: model.reason };

  let version: string | undefined;
  let tags: { ok: boolean; status: number; body: unknown };
  try {
    const result = await withAbort(PROBE_TIMEOUT_MS, options, async (signal, fetchImpl) => {
      const versionResponse = await fetchImpl(`${endpoint.value}/api/version`, { signal });
      const versionBody: unknown = versionResponse.ok
        ? await versionResponse.json().catch(() => undefined)
        : undefined;
      const tagsResponse = await fetchImpl(`${endpoint.value}/api/tags`, { signal });
      const tagsBody: unknown = tagsResponse.ok
        ? await tagsResponse.json().catch(() => undefined)
        : undefined;
      return {
        version:
          isRecord(versionBody) && typeof versionBody.version === 'string'
            ? versionBody.version
            : undefined,
        tags: { ok: tagsResponse.ok, status: tagsResponse.status, body: tagsBody },
      };
    });
    version = result.version;
    tags = result.tags;
  } catch (error) {
    if (error instanceof ModelError && error.kind === 'cancelled') throw error;
    return {
      state: 'unreachable',
      message: `Couldn't reach Ollama at ${endpoint.value}. Check that Ollama is installed and running.`,
    };
  }
  if (!tags.ok) {
    return {
      state: 'unreachable',
      message: `Ollama answered with HTTP ${tags.status} when listing models.`,
    };
  }

  const entries =
    isRecord(tags.body) && Array.isArray(tags.body.models) ? tags.body.models.filter(isRecord) : [];
  const found = entries.find((entry) => matchesModel(modelName(entry), model.value));
  if (!found) {
    return {
      state: 'model-missing',
      message: `${model.value} is not installed in this Ollama.`,
      installed: entries.map(modelName).filter(Boolean),
      ...(version && { version }),
    };
  }
  if (found.remote_host || found.remote_model || isCloudModelName(modelName(found))) {
    const host = typeof found.remote_host === 'string' ? found.remote_host : 'a remote host';
    return {
      state: 'blocked',
      message: `${modelName(found)} is served from ${host}, so trace data would leave this computer. Choose a model that runs locally.`,
    };
  }
  const details = isRecord(found.details) ? found.details : {};
  return {
    state: 'ready',
    ...(version && { version }),
    model: {
      name: modelName(found),
      ...(typeof found.digest === 'string' && { digest: found.digest }),
      ...(typeof details.parameter_size === 'string' && { parameterSize: details.parameter_size }),
      ...(typeof details.quantization_level === 'string' && {
        quantization: details.quantization_level,
      }),
      ...(typeof found.size === 'number' && { sizeBytes: found.size }),
    },
  };
}

export interface ChatReply {
  content: string;
  model: string;
  totalDurationMs?: number;
  promptTokens?: number;
  outputTokens?: number;
}

const nanosToMs = (value: unknown) =>
  typeof value === 'number' ? Math.round(value / 1e6) : undefined;
const asCount = (value: unknown) => (typeof value === 'number' ? value : undefined);

function replyFrom(
  final: Record<string, unknown>,
  content: string,
  fallbackModel: string,
): ChatReply {
  return {
    content,
    model: typeof final.model === 'string' ? final.model : fallbackModel,
    totalDurationMs: nanosToMs(final.total_duration),
    promptTokens: asCount(final.prompt_eval_count),
    outputTokens: asCount(final.eval_count),
  };
}

/** Reads Ollama's newline-delimited JSON stream, reporting progress as content arrives. */
async function readStream(
  response: Response,
  fallbackModel: string,
  onProgress: (receivedCharacters: number) => void,
): Promise<ChatReply> {
  if (!response.body) throw new ModelError('malformed', 'Ollama returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let final: Record<string, unknown> | undefined;

  const handleLine = (line: string) => {
    if (line.trim() === '') return;
    let chunk: unknown;
    try {
      chunk = JSON.parse(line);
    } catch {
      throw new ModelError('malformed', 'Ollama sent part of a response that could not be read.');
    }
    if (!isRecord(chunk)) return;
    if (typeof chunk.error === 'string') {
      throw new ModelError('http', `Ollama reported an error: ${chunk.error.slice(0, 300)}`);
    }
    if (isRecord(chunk.message) && typeof chunk.message.content === 'string') {
      content += chunk.message.content;
      onProgress(content.length);
    }
    if (chunk.done === true) final = chunk;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  handleLine(buffer + decoder.decode());
  if (!final) throw new ModelError('malformed', 'The response ended before Ollama finished.');
  return replyFrom(final, content, fallbackModel);
}

/**
 * Sends the prompt to /api/chat with the summary schema, thinking off and
 * temperature 0. With `onProgress`, the answer is streamed so the UI can show
 * that it is arriving; it is only parsed once complete.
 */
export async function chat(
  config: ModelConfig,
  prompt: ModelPrompt,
  options: ChatOptions = {},
): Promise<ChatReply> {
  const endpoint = checkEndpoint(config.endpoint);
  if (!endpoint.ok) throw new ModelError('blocked', endpoint.reason);
  const model = checkModelName(config.model);
  if (!model.ok) throw new ModelError('blocked', model.reason);
  const { onProgress } = options;

  const body: Record<string, unknown> = {
    model: model.value,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    format: SUMMARY_SCHEMA,
    stream: onProgress !== undefined,
    think: false,
    keep_alive: '5m',
    options: { temperature: 0, num_ctx: config.contextTokens, num_predict: 1024 },
  };

  return withAbort(config.timeoutMs, options, async (signal, fetchImpl) => {
    const send = () =>
      fetchImpl(`${endpoint.value}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

    let response = await send();
    if (response.status === 400) {
      const text = await response.text().catch(() => '');
      // Models without a thinking mode can reject the `think` field; retry once without it.
      if (!/think/i.test(text)) {
        throw new ModelError('http', `Ollama rejected the request: ${text.slice(0, 300)}`);
      }
      delete body.think;
      response = await send();
    }
    if (response.status === 404) {
      throw new ModelError('model-missing', `${model.value} is not installed in this Ollama.`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ModelError(
        'http',
        `Ollama answered with HTTP ${response.status}. ${text.slice(0, 300)}`,
      );
    }

    if (onProgress) return readStream(response, model.value, onProgress);
    const reply: unknown = await response.json().catch(() => undefined);
    if (!isRecord(reply) || !isRecord(reply.message) || typeof reply.message.content !== 'string') {
      throw new ModelError('malformed', 'Ollama returned a response without a message.');
    }
    return replyFrom(reply, reply.message.content, model.value);
  });
}
