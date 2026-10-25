import { describe, expect, it } from 'vitest';
import { buildRunIndex } from '../../domain/runIndex';
import { buildRun, ev, events, isoAt } from '../../test/factories';
import {
  computeLanes,
  computeTimeMarks,
  describeCalls,
  describeRelation,
  formatAttempt,
} from './traceLayout';

function setup(...drafts: Parameters<typeof events>) {
  const index = buildRunIndex(buildRun(events(...drafts)));
  return { index, calls: describeCalls(index) };
}

describe('describeCalls', () => {
  it('records outcomes, denials, and retry attempt numbers', () => {
    const { calls } = setup(
      ev.call('search', 'c1'),
      ev.timeout('search', 'c1'),
      ev.retry('search', 'c1', 2, 3),
      ev.call('search', 'c2'),
      ev.ok('search', 'c2'),
      ev.call('shell', 'c3'),
      ev.deny('shell', 'c3'),
      ev.call('fetch', 'c4'),
    );
    expect(calls.get('c1')).toMatchObject({ outcome: 'timeout', resultId: 'e2', attempt: 1 });
    expect(calls.get('c1')?.maxAttempts).toBe(3);
    expect(calls.get('c2')).toMatchObject({ outcome: 'success', attempt: 2, maxAttempts: 3 });
    expect(calls.get('c3')).toMatchObject({ outcome: 'denied', denialId: 'e7' });
    expect(calls.get('c4')).toMatchObject({ outcome: 'missing' });
    expect(calls.get('c4')?.attempt).toBeUndefined();
  });

  it('formats attempts with and without a maximum', () => {
    expect(formatAttempt({ attempt: 2, maxAttempts: 3 })).toBe('Attempt 2 of 3');
    expect(formatAttempt({ attempt: 1 })).toBe('Attempt 1');
    expect(formatAttempt({})).toBeUndefined();
  });
});

describe('describeRelation', () => {
  it('describes calls, results, retries, and errors by sequence number', () => {
    const { index, calls } = setup(
      ev.call('search', 'c1'),
      ev.timeout('search', 'c1'),
      ev.retry('search', 'c1', 2),
      ev.call('search', 'c2'),
      ev.error('ToolTimeoutError', 'gave up', { callId: 'c2' }),
    );
    const relation = (id: string) => describeRelation(index.byId.get(id)!, index, calls);
    expect(relation('e1')).toBe('Attempt 1 · result #2');
    expect(relation('e2')).toBe('for call #1');
    expect(relation('e3')).toBe('retries call #1 · next attempt #4');
    expect(relation('e4')).toBe('Attempt 2 · no result recorded');
    expect(relation('e5')).toBe('during call #4');
  });

  it('says when a call was denied without a result', () => {
    const { index, calls } = setup(ev.call('shell', 'c1'), ev.deny('shell', 'c1'));
    expect(describeRelation(index.byId.get('e1')!, index, calls)).toBe('denied at #2, no result');
  });
});

describe('computeLanes', () => {
  it('connects each call to its related events and reuses free lanes', () => {
    const { index, calls } = setup(
      ev.call('a', 'c1'),
      ev.allow('a', 'c1'),
      ev.ok('a', 'c1'),
      ev.call('b', 'c2'),
      ev.ok('b', 'c2'),
    );
    const { laneCount, marks } = computeLanes(index.run.events, calls);
    expect(laneCount).toBe(1);
    expect(marks.get('e1')).toEqual([{ lane: 0, segment: 'start', outcome: 'success' }]);
    expect(marks.get('e2')?.[0]?.segment).toBe('node');
    expect(marks.get('e3')?.[0]?.segment).toBe('end');
    expect(marks.get('e4')?.[0]).toMatchObject({ lane: 0, segment: 'start' });
  });

  it('runs an open lane to the end of the list for a call that never returned', () => {
    const { index, calls } = setup(
      ev.call('slow', 'c1'),
      ev.call('fast', 'c2'),
      ev.ok('fast', 'c2'),
      ev.assistant('Waiting'),
    );
    const { laneCount, marks } = computeLanes(index.run.events, calls);
    expect(laneCount).toBe(2);
    expect(marks.get('e1')).toEqual([{ lane: 0, segment: 'start', outcome: 'missing' }]);
    expect(marks.get('e3')).toContainEqual({ lane: 0, segment: 'through', outcome: 'missing' });
    expect(marks.get('e3')).toContainEqual({ lane: 1, segment: 'end', outcome: 'success' });
    expect(marks.get('e4')).toEqual([{ lane: 0, segment: 'tail', outcome: 'missing' }]);
  });

  it('leaves calls unconnected beyond the lane limit', () => {
    const { index, calls } = setup(
      ev.call('a', 'c1'),
      ev.call('b', 'c2'),
      ev.ok('a', 'c1'),
      ev.ok('b', 'c2'),
    );
    const { laneCount, marks } = computeLanes(index.run.events, calls, 1);
    expect(laneCount).toBe(1);
    expect(marks.get('e2')).toEqual([{ lane: 0, segment: 'through', outcome: 'success' }]);
    expect(marks.get('e4')).toBeUndefined();
  });
});

describe('computeTimeMarks', () => {
  it('spans calls to their result and leaves unanswered calls open', () => {
    const run = buildRun(events(ev.call('a', 'c1'), ev.ok('a', 'c1'), ev.call('b', 'c2')), {
      endedAt: isoAt(4000),
    });
    const index = buildRunIndex(run);
    const marks = computeTimeMarks(index, describeCalls(index));
    expect(marks.get('e1')).toEqual({
      kind: 'span',
      start: 0.25,
      end: 0.5,
      open: false,
      outcome: 'success',
    });
    expect(marks.get('e2')).toEqual({ kind: 'tick', at: 0.5 });
    expect(marks.get('e3')).toMatchObject({ kind: 'span', start: 0.75, end: 1, open: true });
  });
});
