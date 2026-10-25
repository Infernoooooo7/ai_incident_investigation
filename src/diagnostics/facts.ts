/**
 * Observed facts: what the trace records, computed without inference.
 *
 * These are shown before any heuristic finding so the investigation starts
 * from evidence ("the run stopped at #8, 12 ms after #7") rather than from an
 * interpretation of it.
 */
import { msBetween } from '../domain/format';
import { buildRunIndex, findTerminalError } from '../domain/runIndex';
import type { RunIndex } from '../domain/runIndex';
import type { AgentEvent, AgentRun } from '../domain/types';

export interface StopFact {
  /** Where the run stopped: the last fatal error, else the last error event, else the last event. */
  terminal: AgentEvent;
  /** The event recorded immediately before `terminal`. */
  after?: AgentEvent;
  /** Time between `after` and `terminal`. */
  gapMs?: number;
}

export interface IdleGap {
  from: AgentEvent;
  to: AgentEvent;
  ms: number;
}

export interface RunCounts {
  events: number;
  toolCalls: number;
  failedToolResults: number;
  timeouts: number;
  retries: number;
  permissionDenials: number;
  missingResults: number;
  errorEvents: number;
}

export interface RunFacts {
  durationMs?: number;
  /** Present only for runs that did not succeed. */
  stop?: StopFact;
  counts: RunCounts;
  /** The longest stretch between consecutive events, when it is at least one second. */
  longestGap?: IdleGap;
}

const MIN_REPORTED_GAP_MS = 1000;

export function computeRunFacts(run: AgentRun, index: RunIndex = buildRunIndex(run)): RunFacts {
  const { events } = run;
  const counts: RunCounts = {
    events: events.length,
    toolCalls: 0,
    failedToolResults: 0,
    timeouts: 0,
    retries: 0,
    permissionDenials: 0,
    missingResults: 0,
    errorEvents: 0,
  };
  for (const event of events) {
    switch (event.kind) {
      case 'tool_call': {
        counts.toolCalls += 1;
        const denied = (index.permissionsByCallId.get(event.callId) ?? []).some(
          (decision) => decision.decision === 'denied',
        );
        if (!index.resultsByCallId.has(event.callId) && !denied) counts.missingResults += 1;
        break;
      }
      case 'tool_result':
        if (event.outcome !== 'success') counts.failedToolResults += 1;
        if (event.outcome === 'timeout') counts.timeouts += 1;
        break;
      case 'retry':
        counts.retries += 1;
        break;
      case 'permission_decision':
        if (event.decision === 'denied') counts.permissionDenials += 1;
        break;
      case 'error':
        counts.errorEvents += 1;
        break;
      case 'agent_message':
        break;
    }
  }

  let longestGap: IdleGap | undefined;
  for (let i = 1; i < events.length; i++) {
    const from = events[i - 1] as AgentEvent;
    const to = events[i] as AgentEvent;
    const ms = msBetween(from.timestamp, to.timestamp);
    if (ms !== undefined && ms >= MIN_REPORTED_GAP_MS && (!longestGap || ms > longestGap.ms)) {
      longestGap = { from, to, ms };
    }
  }

  let stop: StopFact | undefined;
  if (run.status !== 'succeeded') {
    const terminal = findTerminalError(run) ?? events.at(-1);
    if (terminal) {
      const after = events[(index.positionById.get(terminal.id) ?? 0) - 1];
      stop = {
        terminal,
        ...(after && { after, gapMs: msBetween(after.timestamp, terminal.timestamp) }),
      };
    }
  }

  const durationMs = msBetween(run.startedAt, run.endedAt);
  return {
    ...(durationMs !== undefined && durationMs >= 0 && { durationMs }),
    ...(stop && { stop }),
    counts,
    ...(longestGap && { longestGap }),
  };
}
