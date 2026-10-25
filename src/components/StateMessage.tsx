import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import type { Tone } from './tones';

interface StateMessageProps {
  tone?: Tone;
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}

/** Centered message for empty, loading-failed, and not-found states. */
export function StateMessage({
  tone = 'neutral',
  icon,
  title,
  children,
  actions,
  role,
  className,
}: StateMessageProps) {
  return (
    <div className={cx('state-message', `tone-${tone}`, className)} role={role}>
      <span className="state-message__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="state-message__title">{title}</p>
      {children && <div className="state-message__body">{children}</div>}
      {actions && <div className="state-message__actions">{actions}</div>}
    </div>
  );
}
