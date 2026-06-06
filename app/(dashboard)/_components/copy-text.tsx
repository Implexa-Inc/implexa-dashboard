'use client';

/**
 * <CopyText />: a small generic "copy this exact string" button. Used by the
 * Updates surface to hand the user a ready-to-paste plugin update command. The
 * label is configurable; the copied text is whatever `value` holds.
 */

import { useState } from 'react';

export default function CopyText({
  value,
  label = 'copy',
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; no-op */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy "${value}"`}
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded border border-ink-700 text-ink-300 hover:text-ink-50 hover:border-ink-500 hover:bg-ink-800 transition-colors whitespace-nowrap"
    >
      {copied ? (
        <>
          <span aria-hidden="true">✓</span> copied
        </>
      ) : (
        <>
          <span aria-hidden="true" className="font-mono">⧉</span> {label}
        </>
      )}
    </button>
  );
}
