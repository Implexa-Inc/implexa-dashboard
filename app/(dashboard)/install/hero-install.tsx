'use client';

import { useState } from 'react';

/**
 * Hero install card — the primary CTA on /install.
 *
 * Design philosophy (matches entire.io / fly.io / Stripe CLI):
 *   - ONE universal command shown everywhere — marketing site, dashboard,
 *     onboarding emails, README. Same line, fully memorable, shareable.
 *   - The device-auth flow inside the script handles auth via a browser
 *     hop. The user clicks Approve in their browser; the terminal picks
 *     up the freshly-minted API key and continues installing.
 *   - No tokens in the URL. No "this URL expires in 10 min." No "for
 *     logged-in users we show a different command." Just one curl.
 *
 * We deliberately do NOT show the install-token curl variant (even
 * though logged-in users could skip the Approve roundtrip with it) —
 * the consistency win across surfaces is worth the one extra click.
 */
export default function HeroInstall() {
  // The one and only install command. Identical on /install, marketing
  // pages, READMEs, share links — anywhere we promote installation.
  const HERO_CMD = 'curl -fsSL https://core.implexa.ai/install.sh | bash';

  return (
    <section className="mb-10">
      <div className="card !p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-brand-500/15 text-brand-500">
            ★ Recommended
          </span>
          <span className="text-xs text-ink-400">Claude Code (CLI) — one command, ~30s</span>
        </div>

        <div className="rounded-md border border-ink-700 bg-ink-950 px-4 py-3 mb-3 flex items-center gap-3">
          {/* Shell pill — visual cue this is a terminal command */}
          <span className="hidden sm:flex items-center gap-1 text-[11px] text-ink-400 px-2 py-1 rounded bg-ink-800 border border-ink-700 font-mono shrink-0">
            curl
            <span className="text-ink-500">▾</span>
          </span>
          <code className="flex-1 text-sm text-ink-100 font-mono overflow-x-auto whitespace-nowrap">
            {HERO_CMD}
          </code>
          <CopyButton text={HERO_CMD} />
        </div>

        <p className="text-sm text-ink-200 leading-relaxed">
          Paste in your terminal. The script auto-installs everything:{' '}
          <strong className="text-ink-100">API key, hooks, the Implexa plugin, MCP wiring.</strong>{' '}
          Your browser opens to approve the install; once you click Approve, the terminal finishes the rest.
        </p>
        <p className="text-xs text-ink-400 mt-2">Works on macOS, Linux, and Windows (WSL).</p>
      </div>

      {/* After-install commands — three tight code lines, no narrative */}
      <div className="mt-5 pl-1 space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-ink-400 font-medium">After install</p>
        <NextStepLine prefix="Launch Claude Code"            cmd="claude" />
        <NextStepLine prefix="Verify you're connected"       cmd="/implexa:setup" />
        <NextStepLine prefix="Record your first skill"       cmd="/implexa:record-skill" />
      </div>
    </section>
  );
}

function NextStepLine({ prefix, cmd }: { prefix: string; cmd: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-ink-300 w-44 shrink-0">{prefix}</span>
      <code className="font-mono text-xs bg-ink-900 border border-ink-700 rounded px-2 py-1 text-ink-100 flex-1 truncate">
        {cmd}
      </code>
      <CopyButton text={cmd} compact />
    </div>
  );
}

function CopyButton({ text, compact = false }: { text: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    if (typeof navigator === 'undefined') return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={`shrink-0 inline-flex items-center justify-center rounded transition-colors text-[10px] uppercase tracking-wider font-medium ${
        copied
          ? 'bg-success-400/20 text-success-700 dark:text-success-400'
          : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100 border border-ink-700'
      } ${compact ? 'px-2 py-1' : 'px-3 py-1.5'}`}
      aria-label="Copy command"
    >
      {copied ? '✓' : 'Copy'}
    </button>
  );
}
