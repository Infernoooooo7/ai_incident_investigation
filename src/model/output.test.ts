import { describe, expect, it } from 'vitest';
import { toPlainText } from '../domain/richText';
import { linkEventIds, parseModelOutput } from './output';

const KNOWN = new Set(['evt_04', 'evt_07', 'evt_08', '1', '2']);

function answer(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: 'tickets.search timed out twice [evt_04, evt_07] and the run stopped [evt_08].',
    claims: [
      { kind: 'observation', statement: 'Both calls timed out.', event_ids: ['evt_04', 'evt_07'] },
      { kind: 'hypothesis', statement: 'The API may be overloaded.', event_ids: ['evt_99'] },
      { kind: 'observation', statement: 'Something happened.', event_ids: [] },
    ],
    insufficient_evidence: false,
    next_check: 'Check tickets-api health.',
    ...overrides,
  });
}

describe('parseModelOutput', () => {
  it('parses a valid answer and checks each citation against the run', () => {
    const result = parseModelOutput(answer(), KNOWN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { claims, grounding } = result.value;
    expect(claims.map((claim) => claim.grounded)).toEqual([true, false, false]);
    expect(claims[1]?.unknownIds).toEqual(['evt_99']);
    expect(grounding).toEqual({ claims: 3, grounded: 1, uncited: 1, unknownCitations: 1 });
    expect(result.value.nextCheck).toBe('Check tickets-api health.');
  });

  it('turns bracketed citations in the summary into event links', () => {
    const result = parseModelOutput(answer(), KNOWN);
    if (!result.ok) throw new Error(result.reason);
    const events = result.value.summary.filter((segment) => segment.type === 'event');
    expect(events.map((segment) => segment.type === 'event' && segment.eventId)).toEqual([
      'evt_04',
      'evt_07',
      'evt_08',
    ]);
    expect(toPlainText(result.value.summary)).toBe(
      'tickets.search timed out twice [evt_04, evt_07] and the run stopped [evt_08].',
    );
  });

  it('tolerates code fences or a preamble around the JSON', () => {
    const wrapped = `Sure, here is the JSON:\n\`\`\`json\n${answer()}\n\`\`\``;
    expect(parseModelOutput(wrapped, KNOWN).ok).toBe(true);
  });

  it('explains output it cannot use', () => {
    expect(parseModelOutput('no json here', KNOWN)).toEqual({
      ok: false,
      reason: 'The model did not return a JSON object.',
    });
    expect(parseModelOutput('{ "summary": ', KNOWN).ok).toBe(false);
    expect(parseModelOutput(answer({ summary: '' }), KNOWN)).toEqual({
      ok: false,
      reason: 'The answer has no summary.',
    });
    expect(parseModelOutput(answer({ claims: 'none' }), KNOWN).ok).toBe(false);
    expect(parseModelOutput(answer({ insufficient_evidence: 'no' }), KNOWN).ok).toBe(false);
  });

  it('labels unknown claim kinds as hypotheses and limits sizes', () => {
    const claims = Array.from({ length: 20 }, () => ({
      kind: 'fact',
      statement: 'x'.repeat(2000),
      event_ids: ['evt_04'],
    }));
    const result = parseModelOutput(answer({ claims }), KNOWN);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.claims).toHaveLength(12);
    expect(result.value.claims[0]?.kind).toBe('hypothesis');
    expect(result.value.claims[0]?.statement.length).toBeLessThanOrEqual(500);
  });
});

describe('linkEventIds', () => {
  it('only links bracketed citations, so numbers in prose are left alone', () => {
    const { rich, unknownIds } = linkEventIds('It failed 2 times [2] after 1 retry.', KNOWN);
    expect(rich.filter((segment) => segment.type === 'event')).toHaveLength(1);
    expect(toPlainText(rich)).toBe('It failed 2 times [2] after 1 retry.');
    expect(unknownIds).toEqual([]);
  });

  it('ignores brackets that are not citations', () => {
    const { rich, unknownIds } = linkEventIds('Output [truncated 300 characters] was long.', KNOWN);
    expect(rich).toEqual([{ type: 'text', text: 'Output [truncated 300 characters] was long.' }]);
    expect(unknownIds).toEqual([]);
  });

  it('reports ID-like citations that are not in the run', () => {
    expect(linkEventIds('See [evt_42].', KNOWN).unknownIds).toEqual(['evt_42']);
  });
});
