'use client';

/**
 * <ManageTips /> — a quiet, dismissible "how to get the most hands-off agents"
 * card. New users don't intuit the operating model (agents run in THEIR own
 * Claude on THEIR Mac), so a few honest, specific tips raise the success rate:
 * keep Claude running, schedule browser agents, run from your phone.
 *
 * Per-tip dismissal persisted in localStorage; when all are dismissed the card
 * disappears. Rotates through the undismissed tips so it stays small (one at a
 * time) rather than a wall of text. Pure client, no data deps.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Tip = {
  id: string;
  icon: string;
  title: string;
  body: React.ReactNode;
};

// Ordered by leverage. Keep each one TRUE and specific — no fluff.
const TIPS: Tip[] = [
  {
    id: 'keep-claude-running',
    icon: '🟢',
    title: 'Keep Claude running so your agents fire',
    body: (
      <>
        Your agents run inside your <strong>own</strong> Claude, on your Mac. Leave the Claude desktop app
        open (the menu-bar is enough — no window needed) and scheduled agents run on time.
        Implexa keeps your Mac awake for you, so you don’t have to change any sleep settings.
      </>
    ),
  },
  {
    id: 'schedule-browser-agents',
    icon: '🗓️',
    title: 'Put browser agents on a schedule for fully hands-off runs',
    body: (
      <>
        Agents that drive the web (video tools, posting, research on sites you’re logged into) run completely
        on their own when they’re <strong>scheduled</strong> — they fire in the background with no clicks.
        Give one a daily or weekly cadence and it just delivers.
      </>
    ),
  },
  {
    id: 'run-from-phone',
    icon: '📱',
    title: 'Run any agent from your phone',
    body: (
      <>
        Connect Telegram and you can trigger an agent from anywhere — it runs on your Mac and the result comes
        right back to the chat.{' '}
        <Link href="/settings/run-environment" className="text-brand-500 hover:underline">Set up phone &amp; Telegram →</Link>
      </>
    ),
  },
  {
    id: 'one-inbox',
    icon: '📥',
    title: 'Everything lands on Home',
    body: (
      <>
        Every run drops its result on <Link href="/overview" className="text-brand-500 hover:underline">Home</Link> as
        one simple to-do — review it, give feedback, or approve a follow-up in a tap. You never have to go hunting
        for output.
      </>
    ),
  },
];

const LS_KEY = 'implexa:dismissed-tips';

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return new Set(); }
}

export default function ManageTips() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => { setDismissed(loadDismissed()); setReady(true); }, []);

  const live = TIPS.filter((t) => !dismissed.has(t.id));
  if (!ready || live.length === 0) return null;

  const tip = live[idx % live.length];

  function dismiss(id: string) {
    const next = new Set(dismissed); next.add(id);
    setDismissed(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
    setIdx(0);
  }
  function cycle(dir: 1 | -1) {
    setIdx((i) => (i + dir + live.length) % live.length);
  }

  return (
    <div className="card !p-4 mb-6 border-l-2 !border-l-brand-500/50">
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5" aria-hidden>{tip.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-100">{tip.title}</h3>
            <button
              onClick={() => dismiss(tip.id)}
              className="flex-none text-[11px] text-ink-500 hover:text-ink-300"
              title="Don't show this tip again"
            >
              Got it ✓
            </button>
          </div>
          <p className="text-xs text-ink-400 leading-relaxed mt-1">{tip.body}</p>
          {live.length > 1 && (
            <div className="flex items-center gap-2 mt-2.5 text-[11px] text-ink-500">
              <button onClick={() => cycle(-1)} className="hover:text-ink-300" aria-label="Previous tip">‹</button>
              <span className="tabular-nums">{(idx % live.length) + 1}/{live.length} tips</span>
              <button onClick={() => cycle(1)} className="hover:text-ink-300" aria-label="Next tip">›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
