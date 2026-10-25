import { describe, expect, it } from 'vitest';
import supportTimeout from '../data/examples/example-tool-timeout.json';
import { parseSample } from '../test/factories';
import {
  buildEventSearchIndex,
  buildRunSearchText,
  EMPTY_EVENT_FILTERS,
  filterEvents,
  findOffscreenMatches,
  hasActiveEventFilters,
  tokenizeQuery,
} from './search';
import type { EventFilters } from './search';

const { run } = parseSample(supportTimeout);
const searchIndex = buildEventSearchIndex(run.events);
const flagged = new Set(['evt_04', 'evt_07']);

function ids(filters: Partial<EventFilters>): string[] {
  return filterEvents(run.events, { ...EMPTY_EVENT_FILTERS, ...filters }, searchIndex, (id) =>
    flagged.has(id),
  ).map((event) => event.id);
}

describe('tokenizeQuery', () => {
  it('splits on whitespace, keeps quoted phrases, and de-duplicates', () => {
    expect(tokenizeQuery('  Timeout  "timed out" tickets TIMEOUT ')).toEqual([
      'timeout',
      'timed out',
      'tickets',
    ]);
    expect(tokenizeQuery('')).toEqual([]);
  });
});

describe('filterEvents', () => {
  it('returns everything with no filters', () => {
    expect(ids({})).toHaveLength(run.events.length);
    expect(hasActiveEventFilters(EMPTY_EVENT_FILTERS)).toBe(false);
  });

  it('searches tool names, error text, content, and metadata', () => {
    expect(ids({ query: 'tickets.search' })).toEqual([
      'evt_03',
      'evt_04',
      'evt_05',
      'evt_06',
      'evt_07',
      'evt_08',
    ]);
    expect(ids({ query: '"timed out after 30000"' })).toEqual(['evt_04', 'evt_07']);
    expect(ids({ query: 'demo-001 attachments' })).toEqual(['evt_03', 'evt_06']);
    expect(ids({ query: 'req_9a77d2c4' })).toEqual(['evt_06', 'evt_07']);
    expect(ids({ query: 'no-such-thing' })).toEqual([]);
  });

  it('filters by kind, status, and evidence, combined with AND', () => {
    expect(ids({ kinds: ['retry', 'error'] })).toEqual(['evt_05', 'evt_08']);
    expect(ids({ statuses: ['error'] })).toEqual(['evt_04', 'evt_07', 'evt_08']);
    expect(ids({ flaggedOnly: true })).toEqual(['evt_04', 'evt_07']);
    expect(ids({ kinds: ['tool_result'], statuses: ['error'], query: 'req_5c1e0b72' })).toEqual([
      'evt_04',
    ]);
    expect(hasActiveEventFilters({ ...EMPTY_EVENT_FILTERS, flaggedOnly: true })).toBe(true);
  });
});

describe('findOffscreenMatches', () => {
  const event = run.events.find((item) => item.id === 'evt_07');
  if (!event) throw new Error('missing evt_07');

  it('reports sections that matched when the visible text did not', () => {
    expect(findOffscreenMatches(event, ['req_9a77d2c4'], 'tickets.search timed out')).toEqual([
      'metadata',
    ]);
  });

  it('reports nothing when every term is already visible', () => {
    expect(findOffscreenMatches(event, ['timed'], 'tickets.search timed out')).toEqual([]);
    expect(findOffscreenMatches(event, [], 'anything')).toEqual([]);
  });
});

describe('buildRunSearchText', () => {
  it('includes identity, task, tools, and error types', () => {
    const text = buildRunSearchText(run, ['Tool call timed out']);
    for (const term of [
      'example-tool-timeout',
      'support-triage-agent',
      'demo-001',
      'tickets.search',
      'tooltimeouterror',
      'failed',
      'tool call timed out',
    ]) {
      expect(text).toContain(term);
    }
  });
});
