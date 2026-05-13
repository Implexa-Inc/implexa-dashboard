'use client';

/**
 * "Run in Claude" button — copies a trigger phrase to clipboard so the user
 * can paste it into their Claude surface (Claude Code, Desktop, Cursor, etc.)
 * and Implexa's MCP picks it up.
 *
 * Designed to be embedded INSIDE a parent <Link> wrapper without triggering
 * the parent's navigation — uses stopPropagation on the click.
 */

import { useState } from 'react';

export default function RunInClaudeButton({
  skillSlug,
  triggerPhrases,
  skillName,
}: {
  skillSlug: string;
  triggerPhrases?: string[] | null;
  skillName: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  // Pick the first trigger phrase, or fall back to slug + name
  const trigger = (triggerPhrases && triggerPhrases.length > 0)
    ? triggerPhrases[0]
    : `Run the ${skillName} skill`;

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(trigger);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch (_err) {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`text-[11px] font-medium rounded-md px-2 py-1 border transition-colors whitespace-nowrap ${
        state === 'copied'
          ? 'border-success-400/40 bg-success-400/10 text-success-700 dark:text-success-400'
          : state === 'error'
            ? 'border-red-500/40 bg-red-500/10 text-red-500'
            : 'border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-ink-100 hover:border-ink-500'
      }`}
      title={`Copies: "${trigger}". Paste in any Claude surface with Implexa installed.`}
      aria-label={`Copy "${trigger}" to clipboard`}
    >
      {state === 'copied' ? '✓ Copied — paste in Claude' : state === 'error' ? '✗ Try again' : '⚡ Run in Claude'}
    </button>
  );
}
