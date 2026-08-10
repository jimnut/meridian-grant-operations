import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog with correct focus behaviour: focus moves in on open, is trapped
 * while open, Escape closes, and focus returns to the trigger on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  /*
   * Handlers live in refs so the focus effect below can depend on `open` alone.
   * Depending on `onClose` (a fresh arrow function on every parent render) would
   * re-run the effect on every keystroke, and its cleanup would drag focus back
   * to the trigger mid-typing.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRefStore = useRef(initialFocusRef);
  initialFocusRefStore.current = initialFocusRef;

  const focusables = useCallback(
    () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      ),
    [],
  );

  useEffect(() => {
    if (!open) return undefined;

    previousFocus.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    // Prefer the first control inside the body — for a form dialog that is the
    // first field, which is more useful than landing on the close button.
    const bodySelector = FOCUSABLE.split(', ')
      .map((part) => `.dialog__body ${part}`)
      .join(', ');
    const focusTarget =
      initialFocusRefStore.current?.current ??
      dialogRef.current?.querySelector<HTMLElement>(bodySelector) ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialogRef.current;
    // Wait a frame so the element exists and animations do not swallow focus.
    // If focus has already moved inside the dialog by then (a fast keyboard
    // user — or a test — reaching the second field), leave it alone: deferred
    // initial focus must never steal focus mid-interaction.
    const raf = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== dialogRef.current && dialogRef.current?.contains(active)) {
        return;
      }
      focusTarget?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = overflow;
      previousFocus.current?.focus?.();
    };
  }, [open, focusables]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog${wide ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        ref={dialogRef}
      >
        <header className="dialog__header">
          <div style={{ flex: 1 }}>
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
            {description && (
              <p className="dialog__description" id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close dialog">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog used before destructive or irreversible-looking actions. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Focus lands on Cancel, never on the (possibly destructive) action: pressing
  // Enter by reflex must be safe, and confirming should be a deliberate move.
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      initialFocusRef={cancelRef as React.RefObject<HTMLElement>}
      footer={
        <>
          <button type="button" ref={cancelRef} className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{description}</p>
    </Dialog>
  );
}
