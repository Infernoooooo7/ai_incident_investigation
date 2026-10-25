import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyText } from '../export/browser';
import { cx } from '../lib/cx';

type CopyState = 'idle' | 'copied' | 'failed';

const LABELS: Record<CopyState, string> = { idle: 'Copy', copied: 'Copied', failed: 'Copy failed' };

interface CopyButtonProps {
  text: string;
  /** Names what is copied for screen readers, e.g. "input JSON". */
  label: string;
  /** Icon only; the text stays available to screen readers. */
  compact?: boolean;
}

export function CopyButton({ text, label, compact = false }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await copyText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <button
      type="button"
      className={cx('icon-button', compact && 'icon-button--compact')}
      onClick={() => void copy()}
    >
      {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
      <span className={compact ? 'visually-hidden' : undefined} aria-live="polite">
        {LABELS[state]}
      </span>{' '}
      <span className="visually-hidden">{label}</span>
    </button>
  );
}
