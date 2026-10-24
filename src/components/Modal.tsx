import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './Icons';

/**
 * A native <dialog>: the browser traps focus, Escape closes it, and screen
 * readers announce it as a dialog with its heading as the name.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  full = false,
  testId,
  className = '',
}: {
  /** Extra class on the dialog, for special layouts (e.g. the tour sits to one side). */
  className?: string;
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  /** Fills the screen (used for the Activity panel on phones). */
  full?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal focuses the first control (the Close button); move to the field that matters.
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''}${full ? ' modal-full' : ''}${className ? ` ${className}` : ''}`}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="modal-inner">
          <div className="modal-head">
            <h2 id={`${id}-t`}>{title}</h2>
            <button type="button" className="btn btn-quiet icon-only" onClick={onClose} aria-label="Close">
              <CloseIcon size={20} />
            </button>
          </div>
          {description && (
            <p id={`${id}-d`} className="modal-desc">
              {description}
            </p>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}
