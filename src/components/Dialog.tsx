import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Usually a `.dialog__body` followed by a `.dialog__footer`. */
  children: ReactNode;
  className?: string;
}

/**
 * Modal dialog on the native <dialog> element: showModal() provides focus
 * containment, Escape to close, and an inert background. Content renders only
 * while open, so it is rebuilt fresh each time.
 */
export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={cx('dialog', className)}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      {open && (
        <>
          <div className="dialog__header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-button" onClick={onClose}>
              <X size={18} />
              <span className="visually-hidden">Close</span>
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}
