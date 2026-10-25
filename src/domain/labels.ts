import { truncate } from './format';
import type {
  AgentEvent,
  EventKind,
  EventStatus,
  JsonValue,
  MessageRole,
  RunStatus,
  ToolOutcome,
} from './types';

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  agent_message: 'Message',
  tool_call: 'Tool call',
  tool_result: 'Tool result',
  retry: 'Retry',
  error: 'Error',
  permission_decision: 'Permission',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  ok: 'OK',
  warning: 'Warning',
  error: 'Error',
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const ROLE_LABELS: Record<MessageRole, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
};

const OUTCOME_PHRASES: Record<ToolOutcome, string> = {
  success: 'succeeded',
  error: 'failed',
  timeout: 'timed out',
};

/** Title shown in the timeline and details panel. A producer-supplied `name` wins. */
export function getEventTitle(event: AgentEvent): string {
  if (event.name) return event.name;
  switch (event.kind) {
    case 'agent_message':
      return `${ROLE_LABELS[event.role]} message`;
    case 'tool_call':
      return `Call ${event.toolName}`;
    case 'tool_result':
      return `${event.toolName} ${OUTCOME_PHRASES[event.outcome]}`;
    case 'retry': {
      const of = event.maxAttempts ? ` of ${event.maxAttempts}` : '';
      return `Retry ${event.toolName ?? 'step'} (attempt ${event.attempt}${of})`;
    }
    case 'error':
      return event.fatal ? `${event.errorType} (fatal)` : event.errorType;
    case 'permission_decision':
      return `${event.decision === 'denied' ? 'Denied' : 'Allowed'}: ${event.toolName}`;
  }
}

/** One-line secondary text for timeline rows. */
export function getEventPreview(event: AgentEvent, maxLength = 160): string {
  switch (event.kind) {
    case 'agent_message':
      return truncate(event.text, maxLength);
    case 'tool_call':
      return summarizeJson(event.input, maxLength);
    case 'tool_result':
      return event.errorMessage
        ? truncate(event.errorMessage, maxLength)
        : summarizeJson(event.output, maxLength);
    case 'retry':
      return truncate(event.reason, maxLength);
    case 'error':
      return truncate(event.message, maxLength);
    case 'permission_decision':
      return truncate(event.policy ? `${event.action} · ${event.policy}` : event.action, maxLength);
  }
}

/**
 * Short outcome label for the status pill, or undefined when the event is
 * routine (an OK message or call) and a pill would only add noise.
 */
export function getOutcomeLabel(event: AgentEvent): string | undefined {
  switch (event.kind) {
    case 'tool_result':
      if (event.outcome === 'timeout') return 'Timeout';
      return event.outcome === 'error' ? 'Error' : 'OK';
    case 'permission_decision':
      return event.decision === 'denied' ? 'Denied' : 'Allowed';
    case 'retry':
      return 'Retry';
    case 'error':
      return event.fatal ? 'Fatal' : EVENT_STATUS_LABELS[event.status];
    case 'agent_message':
    case 'tool_call':
      return event.status === 'ok' ? undefined : EVENT_STATUS_LABELS[event.status];
  }
}

/** Compact `key: value` rendering of a JSON value for previews. */
export function summarizeJson(value: JsonValue | undefined, maxLength = 160): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return truncate(value, maxLength);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const parts = Object.entries(value).map(([key, entry]) => `${key}: ${JSON.stringify(entry)}`);
    return truncate(parts.join(', '), maxLength);
  }
  return truncate(JSON.stringify(value), maxLength);
}
