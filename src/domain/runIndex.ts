import type {
  AgentErrorEvent,
  AgentEvent,
  AgentRun,
  PermissionDecisionEvent,
  RetryEvent,
  ToolCallEvent,
  ToolResultEvent,
} from './types';

/** Precomputed lookups over a run's events, built once per run. */
export interface RunIndex {
  readonly run: AgentRun;
  readonly byId: ReadonlyMap<string, AgentEvent>;
  /** Zero-based position of each event in `run.events`. */
  readonly positionById: ReadonlyMap<string, number>;
  /** First tool call recorded for each call ID. */
  readonly callsByCallId: ReadonlyMap<string, ToolCallEvent>;
  readonly resultsByCallId: ReadonlyMap<string, readonly ToolResultEvent[]>;
  readonly permissionsByCallId: ReadonlyMap<string, readonly PermissionDecisionEvent[]>;
  readonly errorsByCallId: ReadonlyMap<string, readonly AgentErrorEvent[]>;
  /** Retry events keyed by the call ID they retry. */
  readonly retriesByCallId: ReadonlyMap<string, readonly RetryEvent[]>;
  /** The tool call that a retry event led to (next call to the same tool). */
  readonly nextAttemptByRetryId: ReadonlyMap<string, ToolCallEvent>;
  /** The retry event that led to a given call ID, when the call was a retry. */
  readonly retryByAttemptCallId: ReadonlyMap<string, RetryEvent>;
}

export type EventRelation =
  'call' | 'result' | 'permission' | 'error' | 'retry' | 'previous-attempt' | 'next-attempt';

export interface RelatedEvent {
  event: AgentEvent;
  relation: EventRelation;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildRunIndex(run: AgentRun): RunIndex {
  const byId = new Map<string, AgentEvent>();
  const positionById = new Map<string, number>();
  const callsByCallId = new Map<string, ToolCallEvent>();
  const resultsByCallId = new Map<string, ToolResultEvent[]>();
  const permissionsByCallId = new Map<string, PermissionDecisionEvent[]>();
  const errorsByCallId = new Map<string, AgentErrorEvent[]>();
  const retriesByCallId = new Map<string, RetryEvent[]>();

  run.events.forEach((event, position) => {
    byId.set(event.id, event);
    positionById.set(event.id, position);
    switch (event.kind) {
      case 'tool_call':
        if (!callsByCallId.has(event.callId)) callsByCallId.set(event.callId, event);
        break;
      case 'tool_result':
        pushTo(resultsByCallId, event.callId, event);
        break;
      case 'permission_decision':
        if (event.callId) pushTo(permissionsByCallId, event.callId, event);
        break;
      case 'error':
        if (event.callId) pushTo(errorsByCallId, event.callId, event);
        break;
      case 'retry':
        if (event.previousCallId) pushTo(retriesByCallId, event.previousCallId, event);
        break;
      case 'agent_message':
        break;
    }
  });

  // A retry leads to the next call of the same tool recorded after it.
  const nextAttemptByRetryId = new Map<string, ToolCallEvent>();
  const retryByAttemptCallId = new Map<string, RetryEvent>();
  run.events.forEach((event, position) => {
    if (event.kind !== 'retry') return;
    const toolName =
      event.toolName ??
      (event.previousCallId ? callsByCallId.get(event.previousCallId)?.toolName : undefined);
    if (!toolName) return;
    const nextCall = run.events
      .slice(position + 1)
      .find(
        (candidate): candidate is ToolCallEvent =>
          candidate.kind === 'tool_call' && candidate.toolName === toolName,
      );
    if (!nextCall) return;
    nextAttemptByRetryId.set(event.id, nextCall);
    retryByAttemptCallId.set(nextCall.callId, event);
  });

  return {
    run,
    byId,
    positionById,
    callsByCallId,
    resultsByCallId,
    permissionsByCallId,
    errorsByCallId,
    retriesByCallId,
    nextAttemptByRetryId,
    retryByAttemptCallId,
  };
}

/** The call ID an event refers to, if any. Retries reference a previous call instead. */
export function getCallId(event: AgentEvent): string | undefined {
  switch (event.kind) {
    case 'tool_call':
    case 'tool_result':
      return event.callId;
    case 'permission_decision':
    case 'error':
      return event.callId;
    case 'retry':
    case 'agent_message':
      return undefined;
  }
}

/**
 * The event that ended an unsuccessful run: the last fatal error if one was
 * recorded, otherwise the last event with error status.
 */
export function findTerminalError(run: AgentRun): AgentEvent | undefined {
  const reversed = [...run.events].reverse();
  return (
    reversed.find((event) => event.kind === 'error' && event.fatal) ??
    reversed.find((event) => event.status === 'error')
  );
}

/** Events connected to `event` through call IDs and retry chains, in run order. */
export function getRelatedEvents(index: RunIndex, event: AgentEvent): RelatedEvent[] {
  const found = new Map<string, RelatedEvent>();
  const add = (candidate: AgentEvent | undefined, relation: EventRelation): void => {
    if (candidate && candidate.id !== event.id && !found.has(candidate.id)) {
      found.set(candidate.id, { event: candidate, relation });
    }
  };

  if (event.kind === 'retry') {
    if (event.previousCallId)
      add(index.callsByCallId.get(event.previousCallId), 'previous-attempt');
    add(index.nextAttemptByRetryId.get(event.id), 'next-attempt');
  }

  const callId = getCallId(event);
  if (callId) {
    // The retry chain comes first so its more specific labels win.
    const leadingRetry = index.retryByAttemptCallId.get(callId);
    if (leadingRetry) {
      add(leadingRetry, 'retry');
      if (leadingRetry.previousCallId) {
        add(index.callsByCallId.get(leadingRetry.previousCallId), 'previous-attempt');
      }
    }
    for (const retry of index.retriesByCallId.get(callId) ?? []) {
      add(retry, 'retry');
      add(index.nextAttemptByRetryId.get(retry.id), 'next-attempt');
    }
    add(index.callsByCallId.get(callId), 'call');
    index.permissionsByCallId.get(callId)?.forEach((related) => add(related, 'permission'));
    index.resultsByCallId.get(callId)?.forEach((related) => add(related, 'result'));
    index.errorsByCallId.get(callId)?.forEach((related) => add(related, 'error'));
  }

  const position = (related: RelatedEvent) => index.positionById.get(related.event.id) ?? 0;
  return [...found.values()].sort((a, b) => position(a) - position(b));
}
