/** Compact builders for synthetic runs used in unit tests. */
import { parseRun } from '../data/validate';
import type { AgentEvent, AgentRun, JsonObject, JsonValue } from '../domain/types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event without the bookkeeping fields that `events()` fills in. */
export type EventDraft = DistributiveOmit<
  AgentEvent,
  'id' | 'sequence' | 'timestamp' | 'metadata'
> & {
  metadata?: JsonObject;
};

const START = Date.parse('2026-01-01T00:00:00.000Z');

export function isoAt(offsetMs: number): string {
  return new Date(START + offsetMs).toISOString();
}

/** Assigns ids e1..eN, sequences, and timestamps one second apart. */
export function events(...drafts: EventDraft[]): AgentEvent[] {
  return drafts.map(
    (draft, index) =>
      ({
        ...draft,
        id: `e${index + 1}`,
        sequence: index + 1,
        timestamp: isoAt((index + 1) * 1000),
        metadata: draft.metadata ?? {},
      }) as AgentEvent,
  );
}

export function buildRun(eventList: AgentEvent[], overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run_test',
    agentName: 'test-agent',
    task: 'Do the test task',
    summary: '',
    status: 'failed',
    startedAt: isoAt(0),
    endedAt: isoAt((eventList.length + 1) * 1000),
    metadata: {},
    events: eventList,
    ...overrides,
  };
}

export const ev = {
  user: (text: string): EventDraft => ({ kind: 'agent_message', role: 'user', text, status: 'ok' }),
  assistant: (text: string): EventDraft => ({
    kind: 'agent_message',
    role: 'assistant',
    text,
    status: 'ok',
  }),
  call: (
    toolName: string,
    callId: string,
    input?: JsonValue,
    metadata?: JsonObject,
  ): EventDraft => ({
    kind: 'tool_call',
    toolName,
    callId,
    status: 'ok',
    ...(input !== undefined && { input }),
    ...(metadata && { metadata }),
  }),
  ok: (toolName: string, callId: string, output?: JsonValue): EventDraft => ({
    kind: 'tool_result',
    toolName,
    callId,
    outcome: 'success',
    status: 'ok',
    ...(output !== undefined && { output }),
  }),
  fail: (
    toolName: string,
    callId: string,
    errorCode?: string,
    errorMessage?: string,
  ): EventDraft => ({
    kind: 'tool_result',
    toolName,
    callId,
    outcome: 'error',
    status: 'error',
    ...(errorCode && { errorCode }),
    ...(errorMessage && { errorMessage }),
  }),
  timeout: (toolName: string, callId: string): EventDraft => ({
    kind: 'tool_result',
    toolName,
    callId,
    outcome: 'timeout',
    errorCode: 'TIMEOUT',
    errorMessage: 'timed out after 30000 ms',
    durationMs: 30000,
    status: 'error',
  }),
  retry: (
    toolName: string,
    previousCallId: string,
    attempt: number,
    maxAttempts?: number,
  ): EventDraft => ({
    kind: 'retry',
    toolName,
    previousCallId,
    attempt,
    reason: `${toolName} failed`,
    status: 'warning',
    ...(maxAttempts !== undefined && { maxAttempts }),
  }),
  error: (
    errorType: string,
    message: string,
    options: { fatal?: boolean; callId?: string } = {},
  ): EventDraft => ({
    kind: 'error',
    errorType,
    message,
    fatal: options.fatal ?? true,
    status: 'error',
    ...(options.callId && { callId: options.callId }),
  }),
  deny: (toolName: string, callId: string, policy = 'sandbox.policy'): EventDraft => ({
    kind: 'permission_decision',
    toolName,
    callId,
    action: `Use ${toolName}`,
    decision: 'denied',
    decidedBy: 'policy',
    policy,
    status: 'warning',
  }),
  allow: (toolName: string, callId: string): EventDraft => ({
    kind: 'permission_decision',
    toolName,
    callId,
    action: `Use ${toolName}`,
    decision: 'allowed',
    decidedBy: 'policy',
    status: 'ok',
  }),
};

/** Validates raw sample JSON and fails loudly if it is not a valid run. */
export function parseSample(raw: unknown) {
  const parsed = parseRun(raw);
  if (!parsed.ok) {
    throw new Error(`Sample failed validation: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed;
}
