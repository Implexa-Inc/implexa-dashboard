'use client';

/**
 * <Modal /> , the one pop-out shell for the 2-section redesign.
 *
 * Each row's next-action opens a focused pop-out (feedback, output, …) instead
 * of one combined overlay. This is the shared shell they all use: centered card,
 * backdrop click + Esc to close, scroll-locked, accessible. Keep it dumb , the
 * caller owns the content and the open/close state.
 *
 * Focus: on open, focus moves INTO the dialog (its first focusable control);
 * Tab/Shift+Tab cycle within it; on close, focus returns to the element that
 * had it before the dialog opened. A refusal modal that leaves focus behind a
 * blurred backdrop is one a keyboard user cannot act on.
 */

import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    // Remember where focus was, then move it into the dialog.
    restoreRef.current = (document.activeElement instanceof HTMLElement) ? document.activeElement : null;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) || []);
    const first = focusables().find((el) => el.getAttribute('aria-label') !== 'Close') || focusables()[0] || dialog;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialog) return;
      const list = focusables();
      if (!list.length) { e.preventDefault(); dialog.focus(); return; }
      const firstEl = list[0]; const lastEl = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || !dialog.contains(active))) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && (active === lastEl || !dialog.contains(active))) { e.preventDefault(); firstEl.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const back = restoreRef.current;
      restoreRef.current = null;
      if (back && typeof back.focus === 'function' && back.isConnected) back.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm px-4 py-10"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={dialogRef} tabIndex={-1} className={`card w-full ${maxWidth} my-auto outline-none`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink-50">{title}</h2>
            {subtitle && <div className="mt-1">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-none text-ink-400 hover:text-ink-100 text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
