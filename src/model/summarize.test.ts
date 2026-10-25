import { describe, expect, it } from 'vitest';
import toolTimeout from '../data/examples/example-tool-timeout.json';
import { parseSample } from '../test/factories';
import { DEFAULT_MODEL_CONFIG } from './config';
import type { FetchLike } from './ollama';
import { summarizeRun } from './summarize';

const run = parseSample(toolTimeout).run;

function ollamaReturning(content: string, tags: unknown = { models: [{ name: 'granite4.2:3b' }] }) {
  const sent: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname === '/api/version') return Response.json({ version: '0.20.1' });
    if (pathname === '/api/tags') return Response.json(tags);
    if (pathname === '/api/chat') {
      sent.push(String(init?.body));
      return Response.json({ model: 'granite4.2:3b', message: { content }, done: true });
    }
    throw new TypeError('Failed to fetch');
  };
  return { fetchImpl, sent };
}

const GOOD_ANSWER = JSON.stringify({
  summary: 'The ticket search timed out twice [evt_04, evt_07] and the run stopped [evt_08].',
  claims: [
    {
      kind: 'observation',
      statement: 'Both attempts timed out after 30 s.',
      event_ids: ['evt_04', 'evt_07'],
    },
    {
      kind: 'hypothesis',
      statement: 'I am not sure, but the upstream API may have been overloaded.',
      event_ids: ['evt_04'],
    },
  ],
  insufficient_evidence: false,
  next_check: 'Check tickets-api latency for request req_5c1e0b72.',
});

describe('summarizeRun', () => {
  it('sends the redacted run to the local model and returns a validated summary', async () => {
    const { fetchImpl, sent } = ollamaReturning(GOOD_ANSWER);
    const result = await summarizeRun(run, DEFAULT_MODEL_CONFIG, { fetchImpl });
    expect(result.model.name).toBe('granite4.2:3b');
    expect(result.runtimeVersion).toBe('0.20.1');
    expect(result.summary.grounding).toEqual({
      claims: 2,
      grounded: 2,
      uncited: 0,
      unknownCitations: 0,
    });
    expect(result.disclosure).toMatchObject({ sentEvents: 9, redactedValues: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('ZmFrZS1zaWduYXR1cmU');
  });

  it('keeps the raw reply when the answer cannot be parsed', async () => {
    const { fetchImpl } = ollamaReturning('I think the run failed.');
    await expect(summarizeRun(run, DEFAULT_MODEL_CONFIG, { fetchImpl })).rejects.toMatchObject({
      kind: 'malformed',
      raw: 'I think the run failed.',
    });
  });

  it('refuses to send anything when the configured model is remote', async () => {
    const { fetchImpl, sent } = ollamaReturning(GOOD_ANSWER, {
      models: [{ name: 'granite4.2:3b', remote_host: 'https://ollama.com:443' }],
    });
    await expect(summarizeRun(run, DEFAULT_MODEL_CONFIG, { fetchImpl })).rejects.toMatchObject({
      kind: 'blocked',
    });
    expect(sent).toHaveLength(0);
  });

  it('reports a missing model without sending the trace', async () => {
    const { fetchImpl, sent } = ollamaReturning(GOOD_ANSWER, { models: [] });
    await expect(summarizeRun(run, DEFAULT_MODEL_CONFIG, { fetchImpl })).rejects.toMatchObject({
      kind: 'model-missing',
    });
    expect(sent).toHaveLength(0);
  });
});
