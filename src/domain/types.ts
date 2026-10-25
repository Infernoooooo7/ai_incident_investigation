/**
 * Typed data model for recorded agent runs.
 *
 * The same shape is used by the bundled sample traces and by JSON files a user
 * imports. Untrusted input only becomes these types after passing through
 * `data/validate.ts`.
 */

/** A JSON-compatible value, as found in recorded tool inputs, outputs, and metadata. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export const RUN_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const EVENT_KINDS = [
  'agent_message',
  'tool_call',
  'tool_result',
  'retry',
  'error',
  'permission_decision',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Severity of a single event as reported by the trace producer. */
export const EVENT_STATUSES = ['ok', 'warning', 'error'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const TOOL_OUTCOMES = ['success', 'error', 'timeout'] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];

export const PERMISSION_DECISIONS = ['allowed', 'denied'] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export const PERMISSION_DECIDERS = ['policy', 'user'] as const;
export type PermissionDecider = (typeof PERMISSION_DECIDERS)[number];

interface EventBase {
  /** Unique within its run. */
  id: string;
  /** 1-based position in the run, as recorded by the producer. */
  sequence: number;
  /** ISO-8601 timestamp with a timezone designator. */
  timestamp: string;
  status: EventStatus;
  /** Optional producer-supplied label, e.g. "Plan" or "Final answer". */
  name?: string;
  /** Wall-clock time the event took, where the producer measured it. */
  durationMs?: number;
  input?: JsonValue;
  output?: JsonValue;
  metadata: JsonObject;
}

export interface AgentMessageEvent extends EventBase {
  kind: 'agent_message';
  role: MessageRole;
  text: string;
}

export interface ToolCallEvent extends EventBase {
  kind: 'tool_call';
  toolName: string;
  /** Correlates the call with its result, permission decisions, and retries. */
  callId: string;
}

export interface ToolResultEvent extends EventBase {
  kind: 'tool_result';
  toolName: string;
  callId: string;
  outcome: ToolOutcome;
  errorCode?: string;
  errorMessage?: string;
}

export interface RetryEvent extends EventBase {
  kind: 'retry';
  /** The attempt about to start, e.g. 2 for the first retry. */
  attempt: number;
  maxAttempts?: number;
  reason: string;
  toolName?: string;
  /** The failed call being retried. */
  previousCallId?: string;
  backoffMs?: number;
}

export interface AgentErrorEvent extends EventBase {
  kind: 'error';
  errorType: string;
  message: string;
  /** True when the error terminated the run. */
  fatal: boolean;
  callId?: string;
}

export interface PermissionDecisionEvent extends EventBase {
  kind: 'permission_decision';
  toolName: string;
  /** Human-readable description of what the agent asked to do. */
  action: string;
  decision: PermissionDecision;
  decidedBy: PermissionDecider;
  policy?: string;
  reason?: string;
  callId?: string;
}

export type AgentEvent =
  | AgentMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | RetryEvent
  | AgentErrorEvent
  | PermissionDecisionEvent;

export interface AgentRun {
  id: string;
  agentName: string;
  agentVersion?: string;
  /** What the agent was asked to do. */
  task: string;
  /** One-line outcome summary shown on the dashboard. */
  summary: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string;
  metadata: JsonObject;
  /** Ordered by `sequence`. */
  events: AgentEvent[];
}
