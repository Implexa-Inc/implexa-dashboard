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

// The desktop bridge (present only inside the Implexa app webview).
type DesktopBridge = { isAgentAppRunning?: (surface: string) => Promise<boolean>; openAgent?: (s?: string) => Promise<unknown> };
function bridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: DesktopBridge }).implexaDesktop ?? null;
}

const ROTATE_MS = 9000;

export default function ManageTips() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  // null = can't tell (web / old build) → keep the gentle generic tip.
  // true  = Claude is open → drop the "keep it running" nag.
  // false = Claude is CLOSED → show a loud, actionable alert instead.
  const [claudeRunning, setClaudeRunning] = useState<boolean | null>(null);

  useEffect(() => { setDismissed(loadDismissed()); setReady(true); }, []);

  // Detect whether the Claude desktop app is actually open, and keep it fresh —
  // so the "keep Claude running" message only nags when it's genuinely closed.
  useEffect(() => {
    const b = bridge();
    if (!b?.isAgentAppRunning) return;
    let alive = true;
    const check = async () => {
      try { const up = await b.isAgentAppRunning!('claude'); if (alive) setClaudeRunning(!!up); }
      catch { if (alive) setClaudeRunning(null); }
    };
    check();
    const t = setInterval(check, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Detected CLOSED → a loud, actionable alert (this is what the user must fix).
  const claudeClosed = claudeRunning === false;

  const live = TIPS.filter((t) => {
    if (dismissed.has(t.id)) return false;
    // The keep-running tip is handled by the alert (closed) or unnecessary (open);
    // only keep it in the gentle rotation when we genuinely can't tell.
    if (t.id === 'keep-claude-running' && claudeRunning !== null) return false;
    return true;
  });

  // Auto-rotate the tips on a cadence (pause on hover so a reader isn't yanked).
  useEffect(() => {
    if (paused || live.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % live.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, live.length]);

  if (!ready) return null;
  if (!claudeClosed && live.length === 0) return null;

  const tip = live.length ? live[idx % live.length] : null;

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
    <>
      {/* CLAUDE-CLOSED ALERT — only when we can SEE the app is shut. The whole
          product depends on Claude being open, so this is loud + actionable. */}
      {claudeClosed && (
        <div className="card !p-4 mb-6 border-l-2 !border-l-amber-500" role="alert">
          <div className="flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5" aria-hidden>⚠️</span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-300">Claude isn’t running — your agents can’t fire</h3>
              <p className="text-xs text-ink-300 leading-relaxed mt-1">
                Agents run inside your own Claude on your Mac. Open the Claude desktop app (the menu-bar is enough — no
                window needed) and your scheduled + queued runs go through. Implexa keeps your Mac awake once it’s open.
              </p>
              <button
                onClick={() => bridge()?.openAgent?.('claude')}
                className="mt-2.5 btn-success text-xs px-3 py-1.5"
              >
                Open Claude
              </button>
            </div>
          </div>
        </div>
      )}

      {tip && (
    <div
      className="card !p-4 mb-6 border-l-2 !border-l-brand-500/50"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
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
      )}
    </>
  );
}
