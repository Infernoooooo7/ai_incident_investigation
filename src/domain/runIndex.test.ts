import { describe, expect, it } from 'vitest';
import supportTimeout from '../data/examples/example-tool-timeout.json';
import { parseSample } from '../test/factories';
import { buildRunIndex, findTerminalError, getRelatedEvents } from './runIndex';

const { run } = parseSample(supportTimeout);
const index = buildRunIndex(run);

function related(eventId: string) {
  const event = index.byId.get(eventId);
  if (!event) throw new Error(`no event ${eventId}`);
  return getRelatedEvents(index, event).map(
    ({ event: item, relation }) => `${item.id}:${relation}`,
  );
}

describe('getRelatedEvents', () => {
  it('links a failed result to its call, the retry, and the next attempt', () => {
    expect(related('evt_04')).toEqual(['evt_03:call', 'evt_05:retry', 'evt_06:next-attempt']);
  });

  it('links a retry to the attempts on either side', () => {
    expect(related('evt_05')).toEqual(['evt_03:previous-attempt', 'evt_06:next-attempt']);
  });

  it('links a retried call to its retry, previous attempt, result, and error', () => {
    expect(related('evt_06')).toEqual([
      'evt_03:previous-attempt',
      'evt_05:retry',
      'evt_07:result',
      'evt_08:error',
    ]);
  });

  it('returns nothing for messages', () => {
    expect(related('evt_01')).toEqual([]);
  });
});

describe('findTerminalError', () => {
  it('prefers the last fatal error', () => {
    expect(findTerminalError(run)?.id).toBe('evt_08');
  });
});
