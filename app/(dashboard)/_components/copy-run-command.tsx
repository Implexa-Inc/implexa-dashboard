'use client';

/**
 * <CopyRunCommand />: copies a ready-to-paste command that runs a skill or
 * workflow inside Claude Code or Codex. Bridges the dashboard (web) to the
 * agent: the user clicks, pastes "implexa run <slug>" into their session, and
 * Implexa's recommender resolves + applies it.
 */

import { useState } from 'react';

export default function CopyRunCommand({ slug, kind = 'skill' }: { slug: string; kind?: 'skill' | 'workflow' }) {
  const [copied, setCopied] = useState(false);
  const command = kind === 'workflow' ? `implexa run the ${slug} agent` : `implexa run ${slug}`;

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(command);
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
      title={`Copy "${command}" to paste in Claude Code or Codex`}
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded border border-ink-700 text-ink-300 hover:text-ink-50 hover:border-ink-500 hover:bg-ink-800 transition-colors"
    >
      {copied ? (
        <>
          <span aria-hidden="true">✓</span> copied
        </>
      ) : (
        <>
          <span aria-hidden="true" className="font-mono">▷</span> copy run command
        </>
      )}
    </button>
  );
}
