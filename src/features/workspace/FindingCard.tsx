import { Check, Lightbulb, Undo2, X } from 'lucide-react';
import { memo, useEffect, useId, useRef } from 'react';
import { ConfidenceIndicator } from '../../components/badges';
import { ImpactIcon } from '../../components/ImpactIcon';
import { EventLink, RichTextView } from '../../components/RichTextView';
import { CONFIDENCE_LABELS, IMPACT_LABELS } from '../../diagnostics/types';
import type { Diagnosis, FindingReview } from '../../diagnostics/types';
import { cx } from '../../lib/cx';
import { findingDomId } from './ids';

interface FindingCardProps {
  finding: Diagnosis;
  review?: FindingReview;
  /** True when the selected event is part of this finding's evidence. */
  active: boolean;
  onReview: (findingId: string, review: FindingReview | undefined) => void;
  onRevealEvent: (eventId: string) => void;
}

/**
 * One heuristic finding, split into what the trace shows (observed), what the
 * rule infers from it (interpretation), and what to check next. The reviewer
 * can mark it checked or dismiss it; neither changes the finding itself.
 */
export const FindingCard = memo(function FindingCard({
  finding,
  review,
  active,
  onReview,
  onRevealEvent,
}: FindingCardProps) {
  const titleId = useId();
  const dismissed = review === 'dismissed';
  // The clicked review button is replaced by another one; keep keyboard focus in the group.
  const nextFocus = useRef<HTMLButtonElement>(null);
  const changedHere = useRef(false);
  useEffect(() => {
    if (!changedHere.current) return;
    changedHere.current = false;
    nextFocus.current?.focus();
  }, [review]);
  const change = (next: FindingReview | undefined) => {
    changedHere.current = true;
    onReview(finding.id, next);
  };

  return (
    <article
      id={findingDomId(finding.id)}
      tabIndex={-1}
      className={cx(
        'finding',
        `finding--${finding.impact}`,
        active && 'is-active',
        review && `is-${review}`,
      )}
      aria-labelledby={titleId}
    >
      <div className="finding__header">
        <span className="finding__impact">
          <ImpactIcon impact={finding.impact} size={14} />
          {IMPACT_LABELS[finding.impact]}
        </span>
        <ConfidenceIndicator level={finding.confidence} />
      </div>
      <h4 id={titleId} className="finding__title">
        {finding.title}
      </h4>

      {dismissed ? (
        <p className="finding__dismissed-note">
          You dismissed this finding. It stays in exports, marked as dismissed.
        </p>
      ) : (
        <>
          <div className="finding__block finding__block--observed">
            <p className="finding__label">Observed in the trace</p>
            <p>
              <RichTextView value={finding.observed} onSelectEvent={onRevealEvent} />
            </p>
          </div>
          <div className="finding__block finding__block--interpretation">
            <p className="finding__label">Interpretation · heuristic</p>
            <p>
              <RichTextView value={finding.interpretation} onSelectEvent={onRevealEvent} />
            </p>
          </div>
          <div className="finding__block finding__block--next">
            <p className="finding__label">
              <Lightbulb size={13} />
              Next check
            </p>
            <p>
              <RichTextView value={finding.suggestion} onSelectEvent={onRevealEvent} />
            </p>
          </div>
          <div className="finding__evidence">
            <p className="finding__label">
              Evidence <span className="count-pill">{finding.evidence.length}</span>
            </p>
            <ul className="evidence-list">
              {finding.evidence.map((item) => (
                <li key={item.eventId}>
                  <EventLink eventId={item.eventId} onSelect={onRevealEvent} />
                  <span>{item.note}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="finding__confidence">
            <strong>Why {CONFIDENCE_LABELS[finding.confidence].toLowerCase()} confidence?</strong>{' '}
            {finding.confidenceReason}
          </p>
        </>
      )}

      <fieldset className="finding__review">
        <legend className="visually-hidden">Your review of {finding.title}</legend>
        {review === undefined ? (
          <>
            <button
              ref={nextFocus}
              type="button"
              className="button button--small"
              onClick={() => change('checked')}
            >
              <Check size={14} />
              Mark checked
            </button>
            <button
              type="button"
              className="button button--small button--ghost"
              onClick={() => change('dismissed')}
            >
              <X size={14} />
              Dismiss
            </button>
          </>
        ) : (
          <>
            <span className={cx('review-status', `review-status--${review}`)}>
              {review === 'checked' ? <Check size={14} /> : <X size={14} />}
              {review === 'checked' ? 'Checked by you' : 'Dismissed'}
            </span>
            <button
              ref={nextFocus}
              type="button"
              className="button button--small button--ghost"
              onClick={() => change(undefined)}
            >
              <Undo2 size={14} />
              Undo
            </button>
          </>
        )}
      </fieldset>
    </article>
  );
});
