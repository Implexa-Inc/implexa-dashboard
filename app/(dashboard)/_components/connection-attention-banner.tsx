'use client';

/**
 * <ConnectionAttentionBanner /> - the loud, impossible-to-miss surface for
 * agents that need an account which is not reachable in the Implexa browser.
 * Sibling to <RunAttentionBanner />: same shape, same calm-when-nothing voice.
 *
 * This is the direct fix for the activation trap (live email-agent test,
 * 2026-06-08): an agent that needs a second inbox silently degrades when that
 * inbox is signed out. Silence must never read as success, so a broken
 * connection gets a prominent banner with the reason and a one-tap sign-in, not
 * a quiet red dot buried in a list.
 *
 * Sign in / Verify call the SAME desktop bridge the activation card already
 * uses (window.implexaDesktop.connectAccount/verifyAccount — opens the dedicated
 * Chrome profile straight to that domain's login, no arbitrary URL crosses the
 * bridge). Founder testing caught the old version: this banner still pointed
 * "Sign in" at the static RECONNECT_HREF ('/install') — a placeholder from
 * before the per-domain bridge existed — so clicking it just landed on the
 * marketing download page instead of actually signing anything in. Falls back
 * to that same static link ONLY when running in a plain browser tab (no desktop
 * bridge available at all).
 *
 * Renders nothing when nothing is broken (the calm common case). Used both
 * globally (the Connections page, and reusable on Home) and scoped to a single
 * agent (the agent detail page).
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RECONNECT_HREF, type ConnectionWarning } from '@/lib/connection-warning-types';
import type { ConnectionAdvisory } from '@/lib/connections';

function rel(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type DesktopBridge = {
  connectAccount?: (domain: string) => Promise<{ ok: boolean; message?: string }>;
  verifyAccount?: (domain: string) => Promise<{ ok: boolean; reachable?: boolean; identity?: string; message?: string }>;
};

function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop ?? null;
}

function useDesktopBridge(): DesktopBridge | null {
  const [bridge, setBridge] = useState<DesktopBridge | null>(null);
  useEffect(() => { setBridge(desktopBridge()); }, []);
  return bridge;
}

/** One warning row's Sign in / Verify actions — its own busy/note state so
 * signing in to one account never blocks or mislabels another row. */
function ConnectionWarningRow({ w }: { w: ConnectionWarning }) {
  const bridge = useDesktopBridge();
  const router = useRouter();
  const [busy, setBusy] = useState<'signin' | 'verify' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const signIn = async () => {
    if (!bridge?.connectAccount) return;
    setBusy('signin'); setNote(null);
    try {
      const r = await bridge.connectAccount(w.domain);
      setNote(r.ok ? 'Sign in in the workspace window that just opened, then hit Verify.' : (r.message || 'Could not open the sign-in page.'));
    } catch { setNote('Could not open the sign-in page.'); }
    setBusy(null);
  };
  const verify = async () => {
    if (!bridge?.verifyAccount) return;
    setBusy('verify'); setNote(null);
    try {
      const r = await bridge.verifyAccount(w.domain);
      if (r.ok && r.reachable) {
        setNote(r.identity ? `Connected as ${r.identity}.` : 'Connected.');
        router.refresh(); // re-fetch server data so this warning drops once reachable
      } else {
        setNote(r.ok ? 'Not signed in yet. Hit Sign in, finish in the workspace window, then Verify again.' : (r.message || 'Verify could not run.'));
      }
    } catch { setNote('Verify could not run.'); }
    setBusy(null);
  };

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink-100 truncate">{w.label}</span>
        </div>
        <p className="text-xs text-ink-300 mt-0.5 line-clamp-2">{note || w.reason}</p>
      </div>
      <div className="flex items-center gap-2 flex-none">
        {w.detected_at && !note && <span className="text-[11px] text-ink-500 mt-0.5">{rel(w.detected_at)}</span>}
        {bridge?.connectAccount ? (
          <>
            <button
              type="button"
              onClick={signIn}
              disabled={busy !== null}
              className="text-xs font-medium rounded-md px-2.5 py-1 bg-rose-500/20 text-rose-700 dark:text-rose-200 hover:bg-rose-500/30 transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {busy === 'signin' ? 'Opening…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={verify}
              disabled={busy !== null}
              className="text-xs font-medium rounded-md px-2.5 py-1 border border-ink-700 text-ink-200 hover:bg-ink-800/60 transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {busy === 'verify' ? 'Checking…' : 'Verify'}
            </button>
          </>
        ) : (
          // No desktop bridge (plain browser tab) — the connections concept only
          // works via the Implexa desktop's dedicated Chrome, so point at the app.
          <Link
            href={RECONNECT_HREF}
            className="text-xs font-medium rounded-md px-2.5 py-1 bg-rose-500/20 text-rose-700 dark:text-rose-200 hover:bg-rose-500/30 transition-colors whitespace-nowrap"
          >
            Open the app
          </Link>
        )}
      </div>
    </div>
  );
}

export function ConnectionAttentionBanner({
  warnings,
  /** 'agent' drops the per-row agent name (the page is already about that agent). */
  scope = 'global',
  className = '',
}: {
  warnings: ConnectionWarning[];
  scope?: 'global' | 'agent';
  className?: string;
}) {
  if (warnings.length === 0) return null;

  const heading =
    scope === 'agent'
      ? `This agent needs ${warnings.length} account${warnings.length === 1 ? '' : 's'} you are signed out of`
      : `${warnings.length} connection${warnings.length === 1 ? '' : 's'} need${warnings.length === 1 ? 's' : ''} a sign-in`;

  return (
    <section
      className={`rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none" aria-hidden="true">⚠</span>
        <h2 className="text-sm font-semibold text-ink-50">{heading}</h2>
      </div>
      <p className="text-xs text-ink-300 mt-1">
        Your agents run as you in the Implexa browser. These accounts are signed out or unreachable, so anything that needs them cannot run. Sign in once to fix it.
      </p>
      <ul className="mt-3 space-y-2">
        {warnings.map((w, i) => (
          <li key={`${w.agent_slug}-${w.domain}-${i}`}>
            {scope === 'global' && (
              <Link
                href={`/workflows/${w.agent_slug}`}
                className="text-[11px] uppercase tracking-wide text-ink-400 hover:text-ink-200"
              >
                {w.agent_name}
              </Link>
            )}
            <ConnectionWarningRow w={w} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Signed in, but not proven where the agent acts.
 *
 * Deliberately NOT the rose alarm used for warnings. These accounts work; the weaker
 * claim is about WHERE the proof came from. Styling it as a failure would send the user
 * to fix something that is not broken — and the point of surfacing it is honesty, not
 * urgency.
 */
export function ConnectionAdvisoryNote({
  advisories,
  scope = 'global',
  className = '',
}: {
  advisories: ConnectionAdvisory[];
  scope?: 'global' | 'agent';
  className?: string;
}) {
  if (advisories.length === 0) return null;

  // THREE CASES, because they are three different facts and one of them was being
  // misreported. A stale-pin advisory WAS checked in an agents' browser — just not the
  // one currently selected — so "not yet checked" is false for it. A mixed set gets
  // neutral copy rather than picking one story and being wrong about the rest.
  const noun = scope === 'agent' ? 'account' : 'connection';
  const plural = advisories.length === 1 ? '' : 's';
  const reasons = new Set(advisories.map((a) => a.reason));
  const onlyStale = reasons.size === 1 && reasons.has('verified_in_a_different_agent_browser');
  const onlyWorkspace = reasons.size === 1 && reasons.has('not_verified_in_agent_browser');
  const heading = onlyStale
    ? `${advisories.length} ${noun}${plural} checked in a different agents’ browser than the one currently selected`
    : onlyWorkspace
      // NOT "the workspace browser, not yet the agents' browser" — the managed workspace
      // can BE the agents' browser once its extension is connected. What is actually
      // known is narrower: the proof did not come through the pinned extension.
      ? `${advisories.length} ${noun}${plural} signed in, but not proven through the browser extension your agents use`
      : `${advisories.length} ${noun}${plural} signed in, but their proof does not match the browser your agents currently use`;

  return (
    <section
      className={`rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none" aria-hidden="true">ℹ</span>
        <h2 className="text-sm font-semibold text-ink-50">{heading}</h2>
      </div>
      {/* Conditional, because the two cases are different facts. This paragraph used to
          say "the check ran in Implexa's workspace browser" for EVERY advisory — which is
          simply untrue of a stale pin, where the check did run through an agents'-browser
          extension, just not the one selected now. Telling that user to re-check "where it
          counts" described the wrong problem. */}
      <p className="text-xs text-ink-300 mt-1">
        {onlyStale
          ? 'These were proven through an agents’ browser extension, but not the one currently selected. Run “Check agents’ connections” from the Implexa menu bar to re-confirm them in the browser your agents use now.'
          : onlyWorkspace
            ? 'These are signed in, but the proof did not come through the browser extension your agents use. Run “Check agents’ connections” from the Implexa menu bar to confirm them where it counts.'
            : 'These are signed in, but their proof does not match the browser your agents currently use. Run “Check agents’ connections” from the Implexa menu bar to confirm them where it counts.'}
      </p>
      <ul className="mt-3 space-y-2">
        {advisories.map((a, i) => (
          <li key={`${a.agent_slug}-${a.domain}-${i}`} className="text-xs text-ink-200">
            {scope === 'global' && (
              <Link
                href={`/workflows/${a.agent_slug}`}
                className="text-[11px] uppercase tracking-wide text-ink-400 hover:text-ink-200 mr-2"
              >
                {a.agent_name}
              </Link>
            )}
            <span className="font-medium">{a.domain || a.account}</span>
            <span className="text-ink-400"> — {a.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
