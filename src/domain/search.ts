/** Pure search and filtering over runs and events. */
import { EVENT_KIND_LABELS, getEventTitle, RUN_STATUS_LABELS } from './labels';
import type { AgentEvent, AgentRun, EventKind, EventStatus, RunStatus } from './types';

/**
 * Splits a query into lower-cased terms. Double-quoted phrases stay together:
 * `"timed out" tickets` → ["timed out", "tickets"]. All terms must match.
 */
export function tokenizeQuery(query: string): string[] {
  const terms = [...query.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((match) => (match[1] ?? match[2] ?? '').trim().toLowerCase())
    .filter((term) => term !== '');
  return [...new Set(terms)];
}

export function matchesAllTerms(haystack: string, terms: readonly string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}

/** Lower-cased text covering an event's names, tool, error text, content, and metadata. */
export function buildEventSearchText(event: AgentEvent): string {
  const parts: string[] = [
    event.id,
    event.kind,
    EVENT_KIND_LABELS[event.kind],
    getEventTitle(event),
    event.status,
  ];
  if (event.name) parts.push(event.name);
  switch (event.kind) {
    case 'agent_message':
      parts.push(event.role, event.text);
      break;
    case 'tool_call':
      parts.push(event.toolName, event.callId);
      break;
    case 'tool_result':
      parts.push(event.toolName, event.callId, event.outcome);
      if (event.errorCode) parts.push(event.errorCode);
      if (event.errorMessage) parts.push(event.errorMessage);
      break;
    case 'retry':
      parts.push(event.reason);
      if (event.toolName) parts.push(event.toolName);
      if (event.previousCallId) parts.push(event.previousCallId);
      break;
    case 'error':
      parts.push(event.errorType, event.message);
      if (event.callId) parts.push(event.callId);
      break;
    case 'permission_decision':
      parts.push(event.toolName, event.action, event.decision, event.decidedBy);
      if (event.policy) parts.push(event.policy);
      if (event.reason) parts.push(event.reason);
      if (event.callId) parts.push(event.callId);
      break;
  }
  if (event.input !== undefined) parts.push(JSON.stringify(event.input));
  if (event.output !== undefined) parts.push(JSON.stringify(event.output));
  parts.push(JSON.stringify(event.metadata));
  return parts.join('\n').toLowerCase();
}

export function buildEventSearchIndex(events: readonly AgentEvent[]): Map<string, string> {
  return new Map(events.map((event) => [event.id, buildEventSearchText(event)]));
}

export interface EventFilters {
  query: string;
  /** Empty means every kind. */
  kinds: readonly EventKind[];
  /** Empty means every status. */
  statuses: readonly EventStatus[];
  /** Only events cited as evidence by a finding. */
  flaggedOnly: boolean;
}

export const EMPTY_EVENT_FILTERS: EventFilters = {
  query: '',
  kinds: [],
  statuses: [],
  flaggedOnly: false,
};

export function hasActiveEventFilters(filters: EventFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.kinds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.flaggedOnly
  );
}

export function filterEvents(
  events: readonly AgentEvent[],
  filters: EventFilters,
  searchIndex: ReadonlyMap<string, string>,
  isFlagged: (eventId: string) => boolean,
): AgentEvent[] {
  const terms = tokenizeQuery(filters.query);
  return events.filter(
    (event) =>
      (filters.kinds.length === 0 || filters.kinds.includes(event.kind)) &&
      (filters.statuses.length === 0 || filters.statuses.includes(event.status)) &&
      (!filters.flaggedOnly || isFlagged(event.id)) &&
      (terms.length === 0 || matchesAllTerms(searchIndex.get(event.id) ?? '', terms)),
  );
}

export type MatchSection = 'input' | 'output' | 'metadata';

/**
 * Sections where search terms match even though the row's visible text does
 * not contain them, so the timeline can say why an event matched.
 */
export function findOffscreenMatches(
  event: AgentEvent,
  terms: readonly string[],
  visibleText: string,
): MatchSection[] {
  const visible = visibleText.toLowerCase();
  const unseen = terms.filter((term) => !visible.includes(term));
  if (unseen.length === 0) return [];
  const sections: Array<[MatchSection, unknown]> = [
    ['input', event.input],
    ['output', event.output],
    ['metadata', event.metadata],
  ];
  return sections
    .filter(([, value]) => {
      if (value === undefined) return false;
      const text = JSON.stringify(value).toLowerCase();
      return unseen.some((term) => text.includes(term));
    })
    .map(([section]) => section);
}

/** Lower-cased text for dashboard search: identity, task, outcome, tools, and errors. */
export function buildRunSearchText(run: AgentRun, extra: readonly string[] = []): string {
  const parts = [
    run.id,
    run.agentName,
    run.agentVersion ?? '',
    run.task,
    run.summary,
    run.status,
    RUN_STATUS_LABELS[run.status],
    ...extra,
  ];
  for (const event of run.events) {
    if (event.kind === 'tool_call' || event.kind === 'permission_decision')
      parts.push(event.toolName);
    if (event.kind === 'error') parts.push(event.errorType);
    if (event.kind === 'tool_result' && event.errorCode) parts.push(event.errorCode);
  }
  return parts.join('\n').toLowerCase();
}

export type RunStatusFilter = 'all' | RunStatus;
