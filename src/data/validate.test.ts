import { describe, expect, it } from 'vitest';
import { formatIssue, formatIssueLocation } from './issueText';
import { MAX_EVENTS_PER_RUN, parseRun, parseRunCollection } from './validate';

function validRun(): Record<string, unknown> & { events: unknown[] } {
  return {
    id: 'run_1',
    agentName: 'agent',
    task: 'Task',
    summary: 'Summary',
    status: 'failed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    events: [
      {
        id: 'e1',
        sequence: 1,
        kind: 'tool_call',
        toolName: 'x.search',
        callId: 'c1',
        timestamp: '2026-01-01T00:00:01.000Z',
        status: 'ok',
        input: { q: 'hello' },
      },
      {
        id: 'e2',
        sequence: 2,
        kind: 'tool_result',
        toolName: 'x.search',
        callId: 'c1',
        outcome: 'success',
        timestamp: '2026-01-01T00:00:02.000Z',
        status: 'ok',
      },
    ],
  };
}

describe('parseRun', () => {
  it('accepts a valid run and fills in default metadata', () => {
    const result = parseRun(validRun());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.id).toBe('run_1');
    expect(result.run.metadata).toEqual({});
    expect(result.run.events).toHaveLength(2);
    expect(result.run.events[0]?.metadata).toEqual({});
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects values that are not objects', () => {
    expect(parseRun('nope')).toEqual({
      ok: false,
      issues: [{ path: 'run', message: 'should be a run object, but it is text ("nope")' }],
    });
  });

  it('reports each invalid envelope field with its path', () => {
    const result = parseRun({
      ...validRun(),
      id: '',
      status: 'exploded',
      startedAt: 'yesterday',
      events: 'none',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual([
      'id',
      'status',
      'startedAt',
      'events',
    ]);
    expect(result.issues[1]?.message).toContain(
      'should be one of: succeeded, failed, cancelled, but it is text ("exploded")',
    );
  });

  it('skips a malformed event and keeps the rest of the run', () => {
    const raw = validRun();
    raw.events.push({
      id: 'e3',
      sequence: 3,
      kind: 'error',
      timestamp: '22:19:44',
      status: 'warning',
      errorType: 'StreamWarning',
      message: 'reconnecting',
      fatal: false,
    });
    const result = parseRun(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.events.map((event) => event.id)).toEqual(['e1', 'e2']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ index: 2, id: 'e3' });
    expect(result.skipped[0]?.issues[0]?.path).toBe('events[2].timestamp');
    expect(result.skipped[0]?.issues[0]?.message).toBe(
      'should be a full date and time with a timezone, such as 2026-10-24T14:02:11Z, but it is text ("22:19:44")',
    );
  });

  it('stops at an unknown kind instead of reporting a cascade of missing fields', () => {
    const raw = validRun();
    raw.events.push({
      id: 'e3',
      sequence: 3,
      kind: 'heartbeat',
      timestamp: '2026-01-01T00:00:03.000Z',
      status: 'ok',
    });
    const result = parseRun(raw);
    if (!result.ok) throw new Error('expected the run to load');
    expect(result.skipped[0]?.issues).toEqual([
      {
        path: 'events[2].kind',
        message:
          'should be one of: agent_message, tool_call, tool_result, retry, error, permission_decision, but it is text ("heartbeat")',
      },
    ]);
  });

  it('skips events that reuse an earlier event ID', () => {
    const raw = validRun();
    raw.events.push({ ...(raw.events[1] as object), sequence: 3 });
    const result = parseRun(raw);
    if (!result.ok) throw new Error('expected the run to load');
    expect(result.run.events).toHaveLength(2);
    expect(result.skipped[0]?.issues[0]?.message).toBe(
      'reuses the event ID "e2", which an earlier event already has',
    );
  });

  it('rejects non-JSON values such as functions', () => {
    const raw = validRun();
    (raw.events[0] as Record<string, unknown>).input = { callback: () => 1 };
    const result = parseRun(raw);
    if (!result.ok) throw new Error('expected the run to load');
    expect(result.skipped[0]?.issues[0]).toEqual({
      path: 'events[0].input',
      message: 'contains values that are not plain JSON',
    });
  });

  it('orders events by sequence and warns about inconsistencies', () => {
    const raw = validRun();
    raw.events.reverse();
    raw.events.push({
      id: 'e9',
      sequence: 2,
      kind: 'agent_message',
      role: 'assistant',
      text: 'late',
      timestamp: '2026-01-01T00:05:00.000Z',
      status: 'ok',
    });
    const result = parseRun(raw);
    if (!result.ok) throw new Error('expected the run to load');
    expect(result.run.events.map((event) => event.id)).toEqual(['e1', 'e2', 'e9']);
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      'has a timestamp outside the run start and end times',
      'repeats sequence number 2, so event order may be ambiguous',
    ]);
  });
});

describe('limits and readable locations', () => {
  it('rejects runs with more events than the limit, before parsing them', () => {
    const raw = { ...validRun(), events: new Array(MAX_EVENTS_PER_RUN + 1).fill({}) };
    const result = parseRun(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toBe('has 20,001 events; the limit is 20,000 per run');
  });

  it('turns issue paths into readable locations', () => {
    expect(formatIssueLocation('events[8].timestamp')).toBe('Event 9 › timestamp');
    expect(formatIssueLocation('runs[1].events[0].kind')).toBe('Run 2 › Event 1 › kind');
    expect(formatIssueLocation('[0].agentName')).toBe('Run 1 › agentName');
    expect(formatIssueLocation('run')).toBe('Run');
    expect(formatIssueLocation('(file)')).toBe('File');
    expect(formatIssueLocation('event evt_04')).toBe('Event evt_04');
    expect(formatIssue({ path: 'events[2].status', message: 'is missing' })).toBe(
      'Event 3 › status is missing',
    );
  });
});

describe('parseRunCollection', () => {
  it('accepts a single run, an array of runs, or an object with a runs array', () => {
    expect(parseRunCollection(validRun()).runs).toHaveLength(1);
    expect(parseRunCollection([validRun(), { ...validRun(), id: 'run_2' }]).runs).toHaveLength(2);
    expect(parseRunCollection({ runs: [validRun()] }).runs).toHaveLength(1);
  });

  it('prefixes issue paths with the run position', () => {
    const result = parseRunCollection({
      runs: [validRun(), { ...validRun(), id: 'run_x', task: 7 }],
    });
    expect(result.runs).toHaveLength(1);
    expect(result.rejected).toEqual([
      {
        label: 'run_x',
        issues: [{ path: 'runs[1].task', message: 'should be text, but it is a number (7)' }],
      },
    ]);
  });

  it('explains unrecognized shapes', () => {
    const result = parseRunCollection({ hello: 'world' });
    expect(result.runs).toEqual([]);
    expect(result.rejected[0]?.issues[0]?.message).toContain('does not look like a run');
  });
});
