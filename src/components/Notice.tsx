import {
  CircleCheck,
  Cpu,
  FlaskConical,
  Info,
  OctagonAlert,
  Theater,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { cx } from '../lib/cx';
import type { Tone } from './tones';

const NOTICE_ICONS: Record<Tone, LucideIcon> = {
  neutral: Info,
  info: Info,
  accent: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  example: Theater,
  heuristic: FlaskConical,
  model: Cpu,
};

interface NoticeProps {
  tone: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** Live-region role: "alert" for errors that need immediate attention, "status" for results. */
  announce?: 'alert' | 'status';
  onDismiss?: () => void;
  className?: string;
  /** Makes the notice focusable so it can receive focus, e.g. an error summary. */
  focusRef?: Ref<HTMLDivElement>;
}

export function Notice({
  tone,
  title,
  children,
  announce,
  onDismiss,
  className,
  focusRef,
}: NoticeProps) {
  const Icon = NOTICE_ICONS[tone];
  return (
    <div
      ref={focusRef}
      tabIndex={focusRef ? -1 : undefined}
      className={cx('notice', `tone-${tone}`, className)}
      role={announce}
    >
      <Icon />
      <div className="notice__content">
        {title && <p className="notice__title">{title}</p>}
        {children}
      </div>
      {onDismiss && (
        <button type="button" className="icon-button notice__dismiss" onClick={onDismiss}>
          <X size={16} />
          <span className="visually-hidden">Dismiss</span>
        </button>
      )}
    </div>
  );
}
