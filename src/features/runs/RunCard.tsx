import { CircleCheck } from 'lucide-react';
import { memo } from 'react';
import { runHref } from '../../app/router';
import { runKey } from '../../app/store';
import { ConfidenceIndicator, RunStatusBadge } from '../../components/badges';
import { Highlight } from '../../components/Highlight';
import { ImpactIcon } from '../../components/ImpactIcon';
import { SourceTags } from '../../components/provenance';
import { formatDuration, formatShortDateTime, pluralize } from '../../domain/format';
import { cx } from '../../lib/cx';
import type { RunListItem } from './runListItem';

interface RunCardProps {
  item: RunListItem;
  terms: readonly string[];
  /** Card titles sit one level below the heading of the list they are in. */
  titleLevel: 2 | 3;
}

/**
 * Card pattern: the link holds only the agent name and run ID, so its
 * accessible name stays short; a CSS overlay makes the whole card clickable.
 */
export const RunCard = memo(function RunCard({ item, terms, titleLevel }: RunCardProps) {
  const { loaded, topFinding, durationMs } = item;
  const { run, source, origin, skipped } = loaded;
  const Title = titleLevel === 2 ? 'h2' : 'h3';
  return (
    <article className={cx('run-card', `run-card--${run.status}`)}>
      <div className="run-card__head">
        <RunStatusBadge status={run.status} />
        <SourceTags loaded={loaded} />
        <time className="run-card__time" dateTime={run.startedAt}>
          {formatShortDateTime(run.startedAt)}
        </time>
      </div>
      <Title className="run-card__title">
        <a
          className="run-card__link"
          href={runHref(source, run.id)}
          data-run-key={runKey(source, run.id)}
        >
          <span className="run-card__agent">
            <Highlight text={run.agentName} terms={terms} />
          </span>{' '}
          <span className="run-card__id">
            <Highlight text={run.id} terms={terms} />
          </span>
        </a>
      </Title>
      <p className="run-card__task">
        <Highlight text={run.task} terms={terms} />
      </p>
      {topFinding ? (
        <p className="run-card__finding">
          <span className="run-card__finding-label">
            {topFinding.impact === 'failure-point' ? 'Likely failure point' : 'Top finding'} ·
            heuristic
          </span>
          <span className="run-card__finding-title">
            <ImpactIcon impact={topFinding.impact} size={14} />
            <Highlight text={topFinding.title} terms={terms} />
          </span>
          <ConfidenceIndicator level={topFinding.confidence} />
        </p>
      ) : (
        <p className="run-card__finding run-card__finding--none">
          <CircleCheck size={14} />
          No failure patterns detected
        </p>
      )}
      <p className="run-card__meta">
        <span>{pluralize(run.events.length, 'event')}</span>
        <span>{formatDuration(durationMs)}</span>
        {skipped.length > 0 && (
          <span className="run-card__skipped">{pluralize(skipped.length, 'record')} skipped</span>
        )}
        {origin && (
          <span className="run-card__origin">
            from <Highlight text={origin.fileName} terms={terms} />
          </span>
        )}
      </p>
    </article>
  );
});
