import { FlaskConical } from 'lucide-react';
import { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { EventOutcomeBadge } from '../../components/badges';
import { JsonBlock, TextBlock } from '../../components/CodeBlock';
import { CopyButton } from '../../components/CopyButton';
import { EventKindIcon } from '../../components/EventKindIcon';
import { ImpactIcon } from '../../components/ImpactIcon';
import { Notice } from '../../components/Notice';
import { EventLink } from '../../components/RichTextView';
import type { Diagnosis } from '../../diagnostics/types';
import {
  formatDuration,
  formatOffset,
  formatUtcDate,
  formatUtcTime,
  msBetween,
} from '../../domain/format';
import {
  EVENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  getEventTitle,
  ROLE_LABELS,
} from '../../domain/labels';
import { getRelatedEvents } from '../../domain/runIndex';
import type { EventRelation, RunIndex } from '../../domain/runIndex';
import type { AgentEvent } from '../../domain/types';
import { formatAttempt } from './traceLayout';
import type { CallInfo } from './traceLayout';

const RELATION_LABELS: Record<EventRelation, string> = {
  call: 'Tool call',
  result: 'Result',
  permission: 'Permission decision',
  error: 'Error',
  retry: 'Retry',
  'previous-attempt': 'Previous attempt',
  'next-attempt': 'Next attempt',
};

type Fact = { label: string; value: ReactNode; wide?: boolean };

const mono = (text: string) => <code className="inline-code">{text}</code>;

function kindFacts(event: AgentEvent, calls: ReadonlyMap<string, CallInfo>): Fact[] {
  switch (event.kind) {
    case 'agent_message':
      return [{ label: 'Role', value: ROLE_LABELS[event.role] }];
    case 'tool_call': {
      const attempt = formatAttempt(calls.get(event.callId) ?? {});
      return [
        { label: 'Tool', value: mono(event.toolName) },
        { label: 'Call ID', value: mono(event.callId) },
        ...(attempt ? [{ label: 'Retry chain', value: attempt }] : []),
      ];
    }
    case 'tool_result':
      return [
        { label: 'Tool', value: mono(event.toolName) },
        { label: 'Call ID', value: mono(event.callId) },
        { label: 'Outcome', value: event.outcome },
        ...(event.errorCode ? [{ label: 'Error code', value: mono(event.errorCode) }] : []),
      ];
    case 'retry':
      return [
        {
          label: 'Attempt',
          value: event.maxAttempts
            ? `${event.attempt} of ${event.maxAttempts}`
            : String(event.attempt),
        },
        ...(event.toolName ? [{ label: 'Tool', value: mono(event.toolName) }] : []),
        ...(event.backoffMs !== undefined
          ? [{ label: 'Backoff', value: formatDuration(event.backoffMs) }]
          : []),
        ...(event.previousCallId
          ? [{ label: 'Retries call', value: mono(event.previousCallId) }]
          : []),
        { label: 'Reason', value: event.reason, wide: true },
      ];
    case 'error':
      return [
        { label: 'Error type', value: mono(event.errorType) },
        { label: 'Fatal', value: event.fatal ? 'Yes, the run stopped' : 'No' },
        ...(event.callId ? [{ label: 'Call ID', value: mono(event.callId) }] : []),
      ];
    case 'permission_decision':
      return [
        { label: 'Decision', value: event.decision === 'denied' ? 'Denied' : 'Allowed' },
        { label: 'Decided by', value: event.decidedBy === 'policy' ? 'Policy' : 'User' },
        { label: 'Tool', value: mono(event.toolName) },
        ...(event.policy ? [{ label: 'Policy', value: mono(event.policy) }] : []),
        ...(event.callId ? [{ label: 'Call ID', value: mono(event.callId) }] : []),
        { label: 'Requested action', value: event.action, wide: true },
        ...(event.reason ? [{ label: 'Reason', value: event.reason, wide: true }] : []),
      ];
  }
}

function errorText(event: AgentEvent): string | undefined {
  if (event.kind === 'tool_result') return event.errorMessage;
  if (event.kind === 'error') return event.message;
  return undefined;
}

interface EventDetailsProps {
  event: AgentEvent;
  index: RunIndex;
  calls: ReadonlyMap<string, CallInfo>;
  runStartedAt: string;
  /** Findings that cite this event as evidence. */
  citingFindings: Diagnosis[];
  terms: readonly string[];
  onSelectEvent: (eventId: string) => void;
  onSelectFinding: (findingId: string) => void;
}

/** Everything recorded for one event. Values are rendered as text, never as HTML. */
export function EventDetails({
  event,
  index,
  calls,
  runStartedAt,
  citingFindings,
  terms,
  onSelectEvent,
  onSelectFinding,
}: EventDetailsProps) {
  const headingId = useId();
  const related = useMemo(() => getRelatedEvents(index, event), [index, event]);
  const eventJson = useMemo(() => JSON.stringify(event, null, 2), [event]);

  const facts: Fact[] = [
    {
      label: 'Timestamp',
      value: `${formatUtcDate(event.timestamp)} ${formatUtcTime(event.timestamp)} UTC`,
      wide: true,
    },
    { label: 'Since run start', value: formatOffset(msBetween(runStartedAt, event.timestamp)) },
    {
      label: 'Duration',
      value: event.durationMs !== undefined ? formatDuration(event.durationMs) : 'Not recorded',
    },
    { label: 'Status', value: EVENT_STATUS_LABELS[event.status] },
    ...kindFacts(event, calls),
  ];
  if (event.name) facts.push({ label: 'Name', value: event.name });

  const problem = errorText(event);
  const showInput = event.input !== undefined || event.kind === 'tool_call';
  const showOutput = event.output !== undefined || event.kind === 'tool_result';
  const hasMetadata = Object.keys(event.metadata).length > 0;

  return (
    <article className="event-details" aria-labelledby={headingId}>
      <header className="event-details__header">
        <p className="event-details__eyebrow">
          <EventKindIcon event={event} size={15} />
          {EVENT_KIND_LABELS[event.kind]} · #{event.sequence} · <code>{event.id}</code>
        </p>
        <div className="event-details__title-row">
          <h3 id={headingId}>{getEventTitle(event)}</h3>
          <EventOutcomeBadge event={event} />
        </div>
      </header>

      {citingFindings.length > 0 && (
        <div className="event-details__cited">
          <p className="event-details__cited-title">
            <FlaskConical size={14} />
            Cited as evidence by {citingFindings.length === 1 ? 'a finding' : 'findings'}
          </p>
          <ul>
            {citingFindings.map((finding) => {
              const note = finding.evidence.find((item) => item.eventId === event.id)?.note;
              return (
                <li key={finding.id}>
                  <ImpactIcon impact={finding.impact} size={14} />
                  <span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onSelectFinding(finding.id)}
                    >
                      {finding.title}
                    </button>
                    {note && <span className="muted"> · {note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <dl className="facts">
        {facts.map((fact) => (
          <div key={fact.label} className={fact.wide ? 'facts__wide' : undefined}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>

      {problem && (
        <Notice tone="danger" title={event.kind === 'error' ? 'Error message' : 'Tool error'}>
          <p className="pre-wrap">{problem}</p>
        </Notice>
      )}

      {event.kind === 'agent_message' && (
        <section className="event-details__section">
          <h4>Message</h4>
          <TextBlock text={event.text} label="message text" terms={terms} />
        </section>
      )}

      {showInput && (
        <section className="event-details__section">
          <h4>Input</h4>
          {event.input !== undefined ? (
            <JsonBlock value={event.input} label="input" terms={terms} />
          ) : (
            <p className="event-details__empty">No input was recorded.</p>
          )}
        </section>
      )}

      {showOutput && (
        <section className="event-details__section">
          <h4>Output</h4>
          {event.output !== undefined ? (
            <JsonBlock value={event.output} label="output" terms={terms} />
          ) : (
            <p className="event-details__empty">No output was recorded.</p>
          )}
        </section>
      )}

      <section className="event-details__section">
        <h4>Metadata</h4>
        {hasMetadata ? (
          <JsonBlock value={event.metadata} label="metadata" terms={terms} />
        ) : (
          <p className="event-details__empty">No metadata was recorded.</p>
        )}
      </section>

      {related.length > 0 && (
        <section className="event-details__section">
          <h4>Related events</h4>
          <ul className="related-list">
            {related.map(({ event: relatedEvent, relation }) => (
              <li key={relatedEvent.id}>
                <span className="related-list__relation">{RELATION_LABELS[relation]}</span>
                <EventLink eventId={relatedEvent.id} onSelect={onSelectEvent} />
                <span className="related-list__title">{getEventTitle(relatedEvent)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="event-details__copy">
        <CopyButton text={eventJson} label="this event as JSON" />
      </p>
    </article>
  );
}
