'use client';

/**
 * <ConnectCommand /> — the honey-trap connect step.
 *
 * Until the one-click desktop app ships, this is how a freshly-signed-up user
 * turns their queued agent into a running one: paste one command into their own
 * Claude or Codex. The install script signs them in and installs the Implexa
 * plugin + MCP server; the SessionStart hook then picks up the build request
 * they already queued and builds the agent. Claude and Codex are at parity.
 *
 * We deliberately inline this (rather than link to /install) because it is the
 * single conversion step: the fewer clicks between "I signed up" and "it's
 * running in my Claude", the better.
 */

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ConnectionHeartbeat from './connection-heartbeat';

type Surface = 'claude' | 'codex';

const COMMANDS: Record<Surface, { label: string; cmd: string }> = {
  claude: {
    label: 'Claude Code',
    cmd: 'curl -fsSL https://core.implexa.ai/install.sh | bash',
  },
  codex: {
    label: 'Codex',
    cmd: 'curl -fsSL https://core.implexa.ai/install-for-codex.sh | bash',
  },
};

export default function ConnectCommand() {
  const [surface, setSurface] = useState<Surface>('claude');
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  // Which Implexa account Claude wires to (the command embeds THIS account's
  // key). Surfacing it kills the multi-account footgun: agents run under the
  // account you connect, so you know which one to browse the dashboard as.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(COMMANDS[surface].cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div>
      {/* surface toggle — Claude and Codex are first-class */}
      <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ink-700 bg-ink-900 mb-3">
        {(Object.keys(COMMANDS) as Surface[]).map((s) => {
          const active = s === surface;
          return (
            <button
              key={s}
              type="button"
              onClick={() => { setSurface(s); setCopied(false); }}
              className={
                'px-3 py-1 rounded-full text-xs font-medium transition-colors ' +
                (active ? 'bg-brand-500/15 text-brand-500' : 'text-ink-400 hover:text-ink-100')
              }
            >
              {COMMANDS[s].label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={copy}
        className="group w-full text-left bg-ink-950 border border-ink-700 hover:border-ink-500 rounded-lg overflow-hidden transition-colors"
        aria-label="Copy connect command"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <code className="font-mono text-xs sm:text-sm text-ink-100 overflow-x-auto whitespace-nowrap">
            <span className="text-ink-500 select-none mr-2">$</span>
            {COMMANDS[surface].cmd}
          </code>
          <span
            className={
              'inline-flex items-center gap-1.5 text-xs shrink-0 transition-colors ' +
              (copied ? 'text-success-700 dark:text-success-400' : 'text-ink-400 group-hover:text-ink-200')
            }
          >
            {copied ? '✓ Copied' : 'Copy'}
          </span>
        </div>
      </button>

      {email && (
        <p className="text-xs text-ink-400 mt-2">
          Connecting as <span className="text-ink-100 font-medium">{email}</span>. Your agents and runs live under this account, so sign into the dashboard with it too.
        </p>
      )}

      <p className="text-xs text-ink-500 mt-2 leading-relaxed">
        Paste it in your terminal. It signs you in and installs Implexa into your {COMMANDS[surface].label}.
        Then your agent builds itself, runs as you, free on the plan you already pay for.
      </p>

      {/* Live "are you actually connected?" status (flips green on first heartbeat). */}
      <ConnectionHeartbeat />
    </div>
  );
}
