import { ChevronRight, CircleCheck, Eye, FlaskConical, OctagonAlert } from 'lucide-react';
import { useId } from 'react';
import { Notice } from '../../components/Notice';
import { EventLink } from '../../components/RichTextView';
import { StateMessage } from '../../components/StateMessage';
import { RUN_STATUS_TONES } from '../../components/tones';
import type { LoadedRun } from '../../data/types';
import { RULE_CATALOG } from '../../diagnostics/engine';
import type { RunCounts, RunFacts } from '../../diagnostics/facts';
import type { DiagnosisResult, FindingReview } from '../../diagnostics/types';
import { formatDuration, truncate } from '../../domain/format';
import { getEventTitle, RUN_STATUS_LABELS } from '../../domain/labels';
import type { AgentEvent } from '../../domain/types';
import { cx } from '../../lib/cx';
import { FindingCard } from './FindingCard';
import { ModelPanel } from './ModelPanel';

const COUNT_LABELS: Array<[keyof RunCounts, string]> = [
  ['events', 'Events'],
  ['toolCalls', 'Tool calls'],
  ['failedToolResults', 'Failed results'],
  ['timeouts', 'Timeouts'],
  ['retries', 'Retries'],
  ['permissionDenials', 'Denied permissions'],
  ['missingResults', 'Calls without a result'],
  ['errorEvents', 'Error events'],
];

function describeEvent(event: AgentEvent): string {
  return event.kind === 'error'
    ? `${event.errorType}: ${truncate(event.message, 140)}`
    : getEventTitle(event);
}

interface ObservedFactsProps {
  loaded: LoadedRun;
  facts: RunFacts;
  onRevealEvent: (eventId: string) => void;
}

/** Facts read directly from the trace, with no interpretation. */
function ObservedFacts({ loaded, facts, onRevealEvent }: ObservedFactsProps) {
  const headingId = useId();
  const { run } = loaded;
  const { stop, counts, longestGap } = facts;
  const lastEvent = run.events.at(-1);

  return (
    <section className="analysis-section observed" aria-labelledby={headingId}>
      <div className="analysis-section__header">
        <h3 id={headingId}>What the trace shows</h3>
        <span className="kind-label kind-label--observed">
          <Eye size={13} />
          Observed
        </span>
      </div>
      <div className={cx('outcome', `tone-${RUN_STATUS_TONES[run.status]}`)}>
        {run.status === 'succeeded' ? (
          <CircleCheck size={18} aria-hidden="true" />
        ) : (
          <OctagonAlert size={18} aria-hidden="true" />
        )}
        <div className="outcome__text">
          {run.status === 'succeeded' ? (
            <p>
              <strong>The run reported success.</strong>
              {lastEvent && (
                <>
                  {' '}
                  The last event was <EventLink eventId={lastEvent.id} onSelect={onRevealEvent} /> (
                  {getEventTitle(lastEvent)}).
                </>
              )}
            </p>
          ) : stop ? (
            <>
              <p>
                <strong>The run {RUN_STATUS_LABELS[run.status].toLowerCase()}</strong> at{' '}
                <EventLink eventId={stop.terminal.id} onSelect={onRevealEvent} />:{' '}
                {describeEvent(stop.terminal)}
              </p>
              {stop.after && (
                <p className="outcome__secondary">
                  The event just before it was{' '}
                  <EventLink eventId={stop.after.id} onSelect={onRevealEvent} /> (
                  {getEventTitle(stop.after)})
                  {stop.gapMs !== undefined && stop.gapMs >= 0
                    ? `, ${formatDuration(stop.gapMs)} earlier.`
                    : '.'}
                </p>
              )}
            </>
          ) : (
            <p>
              <strong>The run {RUN_STATUS_LABELS[run.status].toLowerCase()}</strong> with no valid
              events recorded.
            </p>
          )}
          {run.summary && <p className="outcome__secondary">Agent&apos;s summary: {run.summary}</p>}
        </div>
      </div>
      <dl className="stat-grid">
        {COUNT_LABELS.map(([key, label]) => (
          <div key={key} className={cx(counts[key] === 0 && 'is-zero')}>
            <dt>{label}</dt>
            <dd>{counts[key]}</dd>
          </div>
        ))}
      </dl>
      <p className="observed__line">
        Duration {formatDuration(facts.durationMs)}
        {longestGap && (
          <>
            {' '}
            · longest pause {formatDuration(longestGap.ms)}, between{' '}
            <EventLink eventId={longestGap.from.id} onSelect={onRevealEvent} /> and{' '}
            <EventLink eventId={longestGap.to.id} onSelect={onRevealEvent} />
          </>
        )}
      </p>
    </section>
  );
}

function RuleCatalog() {
  return (
    <details className="disclosure rule-catalog">
      <summary>
        <ChevronRight size={16} />
        How findings are produced
      </summary>
      <div className="rule-catalog__content">
        <p>
          A fixed set of deterministic rules reads the recorded events. No language model is
          involved and no causal analysis is performed: a finding means the events match a known
          failure pattern, not that the cause is proven.
        </p>
        <p>
          <strong>High confidence:</strong> the events directly show the pattern and nothing later
          contradicts it. <strong>Medium:</strong> the pattern is present, but other events weaken
          its link to the outcome, or the trace is incomplete. <strong>Low:</strong> a weak signal
          or a fallback pointer; use it only as a starting point.
        </p>
        <dl className="rule-catalog__rules">
          {RULE_CATALOG.map((rule) => (
            <div key={rule.id}>
              <dt>{rule.title}</dt>
              <dd>{rule.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}

interface AnalysisPaneProps {
  loaded: LoadedRun;
  storeKey: string;
  diagnosis: DiagnosisResult;
  facts: RunFacts;
  reviews: ReadonlyMap<string, FindingReview>;
  onReview: (findingId: string, review: FindingReview | undefined) => void;
  selectedEventId?: string;
  onRevealEvent: (eventId: string) => void;
}

export function AnalysisPane({
  loaded,
  storeKey,
  diagnosis,
  facts,
  reviews,
  onReview,
  selectedEventId,
  onRevealEvent,
}: AnalysisPaneProps) {
  const headingId = useId();
  const findingsHeadingId = useId();
  const { findings, ruleFailures } = diagnosis;
  const reviewed = findings.filter((finding) => reviews.has(finding.id)).length;

  return (
    <section className="pane analysis-pane" aria-labelledby={headingId}>
      <div className="pane__header">
        <h2 id={headingId} className="pane__title">
          Analysis
        </h2>
      </div>
      <div className="pane__body">
        <ObservedFacts loaded={loaded} facts={facts} onRevealEvent={onRevealEvent} />

        <section className="analysis-section findings" aria-labelledby={findingsHeadingId}>
          <div className="analysis-section__header">
            <h3 id={findingsHeadingId}>
              Findings <span className="count-pill">{findings.length}</span>
            </h3>
            <span className="kind-label kind-label--heuristic">
              <FlaskConical size={13} />
              Heuristic
            </span>
          </div>
          <p className="analysis-section__intro">
            Fixed rules matched these patterns in the recorded events. They are leads to verify
            against the cited events, not root causes.
            {findings.length > 0 && ` ${reviewed} of ${findings.length} reviewed.`}
          </p>
          {ruleFailures.length > 0 && (
            <Notice tone="warning" title="Some rules could not run on this trace">
              <ul className="issue-list">
                {ruleFailures.map((failure) => (
                  <li key={failure.ruleId}>
                    <code className="inline-code">{failure.ruleId}</code>: {failure.message}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {findings.length === 0 ? (
            <StateMessage
              tone="success"
              icon={<CircleCheck />}
              title="No failure patterns detected"
              className="state-message--inline"
            >
              <p>
                {loaded.run.events.length === 0
                  ? 'This run has no valid events to analyze.'
                  : 'The rules found no failed or timed-out tool calls, denied permissions, missing results, malformed inputs, or repeated failures. That does not prove the run was correct.'}
              </p>
            </StateMessage>
          ) : (
            <ol className="finding-list">
              {findings.map((finding) => (
                <li key={finding.id}>
                  <FindingCard
                    finding={finding}
                    review={reviews.get(finding.id)}
                    active={
                      selectedEventId !== undefined &&
                      finding.evidence.some((item) => item.eventId === selectedEventId)
                    }
                    onReview={onReview}
                    onRevealEvent={onRevealEvent}
                  />
                </li>
              ))}
            </ol>
          )}
          <RuleCatalog />
        </section>

        <ModelPanel loaded={loaded} storeKey={storeKey} onRevealEvent={onRevealEvent} />
      </div>
    </section>
  );
}
