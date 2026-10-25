import { CircleCheck, CircleSlash, CircleX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CONFIDENCE_LABELS } from '../diagnostics/types';
import type { Confidence } from '../diagnostics/types';
import { getOutcomeLabel, RUN_STATUS_LABELS } from '../domain/labels';
import type { AgentEvent, RunStatus } from '../domain/types';
import { cx } from '../lib/cx';
import { EVENT_STATUS_TONES, RUN_STATUS_TONES } from './tones';
import type { Tone } from './tones';

const RUN_STATUS_ICONS: Record<RunStatus, LucideIcon> = {
  succeeded: CircleCheck,
  failed: CircleX,
  cancelled: CircleSlash,
};

interface BadgeProps {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span className={cx('badge', `tone-${tone}`, className)}>
      {icon}
      {children}
    </span>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const Icon = RUN_STATUS_ICONS[status];
  return (
    <Badge tone={RUN_STATUS_TONES[status]} icon={<Icon />}>
      {RUN_STATUS_LABELS[status]}
    </Badge>
  );
}

export function EventOutcomeBadge({ event }: { event: AgentEvent }) {
  const label = getOutcomeLabel(event);
  if (!label) return null;
  return <Badge tone={EVENT_STATUS_TONES[event.status]}>{label}</Badge>;
}

/** Three-bar meter plus text; the text carries the meaning, the bars are decoration. */
export function ConfidenceIndicator({
  level,
  compact = false,
}: {
  level: Confidence;
  compact?: boolean;
}) {
  return (
    <span className={cx('confidence', `confidence--${level}`)}>
      <span className="confidence__bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {CONFIDENCE_LABELS[level]}{' '}
      {compact ? <span className="visually-hidden">confidence</span> : 'confidence'}
    </span>
  );
}
