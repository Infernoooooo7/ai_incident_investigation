/**
 * Pure layout data for the trace view: how each tool call ended, retry
 * attempt numbers, the "lanes" that connect a call to its result, and the
 * position of each event on the run's time axis. Everything here is derived
 * from recorded events only.
 */
import { msBetween } from '../../domain/format';
import { getCallId } from '../../domain/runIndex';
import type { RunIndex } from '../../domain/runIndex';
import type { AgentEvent, ToolCallEvent, ToolOutcome } from '../../domain/types';

/** How a tool call ended, as far as the trace shows. */
export type CallOutcome = ToolOutcome | 'denied' | 'missing';

export interface CallInfo {
  call: ToolCallEvent;
  outcome: CallOutcome;
  /** The last recorded result, if any. */
  resultId?: string;
  /** The permission decision that denied the call, if any. */
  denialId?: string;
  /** Attempt number, when the call is part of a retry chain. */
  attempt?: number;
  maxAttempts?: number;
}

export function describeCalls(index: RunIndex): Map<string, CallInfo> {
  const calls = new Map<string, CallInfo>();
  for (const [callId, call] of index.callsByCallId) {
    const result = index.resultsByCallId.get(callId)?.at(-1);
    const denial = index.permissionsByCallId
      .get(callId)
      ?.find((decision) => decision.decision === 'denied');
    const leadingRetry = index.retryByAttemptCallId.get(callId);
    const firstRetry = index.retriesByCallId.get(callId)?.[0];

    const info: CallInfo = {
      call,
      outcome: result ? result.outcome : denial ? 'denied' : 'missing',
    };
    if (result) info.resultId = result.id;
    if (denial) info.denialId = denial.id;
    if (leadingRetry) {
      info.attempt = leadingRetry.attempt;
      if (leadingRetry.maxAttempts !== undefined) info.maxAttempts = leadingRetry.maxAttempts;
    } else if (firstRetry) {
      info.attempt = 1;
      if (firstRetry.maxAttempts !== undefined) info.maxAttempts = firstRetry.maxAttempts;
    }
    calls.set(callId, info);
  }
  return calls;
}

export function formatAttempt(info: Pick<CallInfo, 'attempt' | 'maxAttempts'>): string | undefined {
  if (info.attempt === undefined) return undefined;
  return info.maxAttempts !== undefined
    ? `Attempt ${info.attempt} of ${info.maxAttempts}`
    : `Attempt ${info.attempt}`;
}

/**
 * A short sentence describing how an event relates to others, using sequence
 * numbers as shown in the trace: "Attempt 2 of 3 · result #7".
 */
export function describeRelation(
  event: AgentEvent,
  index: RunIndex,
  calls: ReadonlyMap<string, CallInfo>,
): string | undefined {
  const seq = (id: string | undefined) => {
    const target = id ? index.byId.get(id) : undefined;
    return target ? `#${target.sequence}` : undefined;
  };
  const callSeq = (callId: string | undefined) =>
    callId ? seq(calls.get(callId)?.call.id) : undefined;

  switch (event.kind) {
    case 'tool_call': {
      const info = calls.get(event.callId);
      if (!info || info.call.id !== event.id) return undefined;
      const parts = [formatAttempt(info)];
      if (info.resultId) parts.push(`result ${seq(info.resultId)}`);
      else if (info.denialId) parts.push(`denied at ${seq(info.denialId)}, no result`);
      else parts.push('no result recorded');
      return parts.filter(Boolean).join(' · ');
    }
    case 'tool_result': {
      const call = callSeq(event.callId);
      return call ? `for call ${call}` : 'no matching call recorded';
    }
    case 'permission_decision': {
      const call = callSeq(event.callId);
      return call ? `for call ${call}` : undefined;
    }
    case 'error': {
      const call = callSeq(event.callId);
      return call ? `during call ${call}` : undefined;
    }
    case 'retry': {
      const previous = callSeq(event.previousCallId);
      const next = seq(index.nextAttemptByRetryId.get(event.id)?.id);
      const parts = [previous && `retries call ${previous}`, next && `next attempt ${next}`];
      const text = parts.filter(Boolean).join(' · ');
      return text === '' ? undefined : text;
    }
    case 'agent_message':
      return undefined;
  }
}

export type LaneSegment = 'start' | 'node' | 'end' | 'through' | 'tail';

export interface LaneMark {
  lane: number;
  segment: LaneSegment;
  outcome: CallOutcome;
}

export interface LaneLayout {
  laneCount: number;
  /** Lane marks drawn in each event's row, keyed by event ID. */
  marks: Map<string, LaneMark[]>;
}

interface Interval {
  callId: string;
  start: number;
  end: number;
  members: Set<number>;
  outcome: CallOutcome;
  /** The call never returned, so the lane runs on to the end of the list. */
  open: boolean;
}

/**
 * Connects each tool call to its permission decisions, results, and errors
 * with a vertical lane. A call without a result gets an open lane that runs
 * to the end of the list. Lanes are reused once free; calls that would need
 * more than `maxLanes` lanes are left unconnected (their rows still say how
 * they relate in text).
 */
export function computeLanes(
  events: readonly AgentEvent[],
  calls: ReadonlyMap<string, CallInfo>,
  maxLanes = 3,
): LaneLayout {
  const byCall = new Map<string, number[]>();
  events.forEach((event, position) => {
    const callId = getCallId(event);
    if (callId === undefined || !calls.has(callId)) return;
    const list = byCall.get(callId);
    if (list) list.push(position);
    else byCall.set(callId, [position]);
  });

  const last = events.length - 1;
  const intervals: Interval[] = [];
  for (const [callId, positions] of byCall) {
    const info = calls.get(callId);
    if (!info) continue;
    const start = Math.min(...positions);
    const open = info.outcome === 'missing' && start < last;
    const end = open ? last : Math.max(...positions);
    if (end === start) continue;
    intervals.push({
      callId,
      start,
      end,
      members: new Set(positions),
      outcome: info.outcome,
      open,
    });
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  const laneEnds: number[] = [];
  const marks = new Map<string, LaneMark[]>();
  for (const interval of intervals) {
    let lane = laneEnds.findIndex((end) => end < interval.start);
    if (lane === -1) {
      if (laneEnds.length >= maxLanes) continue;
      lane = laneEnds.length;
      laneEnds.push(interval.end);
    } else {
      laneEnds[lane] = interval.end;
    }
    for (let position = interval.start; position <= interval.end; position++) {
      const event = events[position];
      if (!event) continue;
      let segment: LaneSegment;
      if (position === interval.start) segment = 'start';
      else if (position === interval.end) segment = interval.open ? 'tail' : 'end';
      else segment = interval.members.has(position) ? 'node' : 'through';
      const list = marks.get(event.id) ?? [];
      list.push({ lane, segment, outcome: interval.outcome });
      marks.set(event.id, list);
    }
  }
  return { laneCount: laneEnds.length, marks };
}

export type TimeMark =
  | { kind: 'span'; start: number; end: number; open: boolean; outcome: CallOutcome }
  | { kind: 'tick'; at: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Positions on the run's time axis as fractions (0 = run start, 1 = run end).
 * A tool call spans from the call to its result (or denial); a call that never
 * returned spans to the end of the run. Other events are a single tick.
 */
export function computeTimeMarks(
  index: RunIndex,
  calls: ReadonlyMap<string, CallInfo>,
): Map<string, TimeMark> {
  const { run } = index;
  const offset = (iso: string) => msBetween(run.startedAt, iso);
  const lastOffset = Math.max(0, ...run.events.map((event) => offset(event.timestamp) ?? 0));
  const total = Math.max(offset(run.endedAt) ?? 0, lastOffset, 1);
  const fraction = (iso: string) => clamp01((offset(iso) ?? 0) / total);

  const marks = new Map<string, TimeMark>();
  for (const event of run.events) {
    const info = event.kind === 'tool_call' ? calls.get(event.callId) : undefined;
    if (info && info.call.id === event.id) {
      const endId = info.resultId ?? info.denialId;
      const endEvent = endId ? index.byId.get(endId) : undefined;
      const start = fraction(event.timestamp);
      marks.set(event.id, {
        kind: 'span',
        start,
        end: endEvent ? Math.max(start, fraction(endEvent.timestamp)) : 1,
        open: endEvent === undefined,
        outcome: info.outcome,
      });
    } else {
      marks.set(event.id, { kind: 'tick', at: fraction(event.timestamp) });
    }
  }
  return marks;
}
