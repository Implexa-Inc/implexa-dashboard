'use client';

/**
 * The app-first "get the app" experience. macOS auto-starts the dmg download;
 * other platforms get the one-command connect as the fallback. We poll the
 * user's connection status and, the instant their executor checks in, advance
 * to the dashboard — so opening the app is the only step that gates them.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_LANDING_ROUTE } from '@/lib/navigation';

const CONNECT_CURL = 'curl -fsSL https://core.implexa.ai/install.sh | bash';
const POLL_MS = 4000;

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return true; // assume mac (SSR / our primary target)
  const ua = navigator.userAgent || '';
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || '';
  const hay = `${ua} ${plat}`.toLowerCase();
  return /mac|iphone|ipad|darwin/.test(hay) && !/windows|android/.test(hay);
}

export default function GetAppClient({ dmgUrl, firstName }: { dmgUrl: string; firstName: string | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [isMac, setIsMac] = useState(true);
  const [downloaded, setDownloaded] = useState(false);
  const [intent, setIntent] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  // Platform + the build intent they typed on the marketing site (carried in
  // localStorage at signup); shown so the wait feels purposeful.
  useEffect(() => {
    setIsMac(detectMac());
    try {
      const i = window.localStorage.getItem('implexa_pending_intent');
      if (i && i.trim()) setIntent(i.trim());
    } catch { /* private mode */ }
  }, []);

  // Auto-start the download on macOS (once). A visible button is the reliable
  // fallback — some browsers need the click — but most honor a direct file link.
  useEffect(() => {
    if (started.current || typeof window === 'undefined') return;
    if (!detectMac()) return;
    started.current = true;
    const t = setTimeout(() => { triggerDownload(); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function triggerDownload() {
    try {
      const a = document.createElement('a');
      a.href = dmgUrl;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setDownloaded(true);
    } catch { /* fall back to the visible link */ }
  }

  // Poll connection status. The dashboard is gated on the same signal, so the
  // moment the app/plugin talks to the backend we advance them straight in.
  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !alive) return;
        // Two signals, either unlocks: real MCP/hook activity (a run happened),
        // OR the app simply being open (its drainer bumps api_keys.last_used_at
        // every ~20s). The dashboard gate accepts the same pair.
        const [{ data: u }, { data: keys }] = await Promise.all([
          supabase.from('users').select('last_mcp_call_at, last_hook_event_at').eq('id', user.id).maybeSingle(),
          supabase.from('api_keys').select('last_used_at').eq('user_id', user.id).eq('status', 'active').not('last_used_at', 'is', null).limit(1),
        ]);
        if (!alive) return;
        const connectedNow = !!(u && (u.last_mcp_call_at || u.last_hook_event_at)) || ((keys || []).length > 0);
        if (connectedNow) {
          setConnected(true);
          // Brief beat on the success state, then into the product — via the
          // state-aware landing, so a user who connected while work was already
          // waiting lands on it rather than on a page we picked here.
          setTimeout(() => { if (alive) router.push(DEFAULT_LANDING_ROUTE); }, 1400);
        }
      } catch { /* keep polling */ }
    }
    check();
    const t = setInterval(check, POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyCurl() {
    navigator.clipboard?.writeText(CONNECT_CURL).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }

  if (connected) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 bg-ink-950">
        <div className="text-center">
          <div className="mx-auto mb-5 h-14 w-14 rounded-full bg-success-500/15 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-success-400" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-ink-50">You&apos;re connected</h1>
          <p className="mt-2 text-ink-400">Taking you to your agents…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ink-950 text-ink-100 px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-8">
          <span className="text-sm font-semibold tracking-tight text-brand-500">Implexa</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-semibold text-ink-50 leading-tight">
          {firstName ? `${firstName}, get the app to start` : 'Get the app to start'}
        </h1>
        <p className="mt-3 text-ink-400 leading-relaxed">
          Implexa runs your agents inside your own Claude or Codex, on your machine — so the desktop app
          is where everything happens. {isMac ? 'Your download is starting now.' : ''}
        </p>

        {intent && (
          <div className="mt-5 rounded-lg border border-brand-500/30 bg-brand-500/5 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-brand-400 font-semibold">Waiting to build</p>
            <p className="mt-1 text-sm text-ink-200">&ldquo;{intent.length > 160 ? intent.slice(0, 160) + '…' : intent}&rdquo;</p>
            <p className="mt-1 text-xs text-ink-500">It&apos;s saved to your account — the app picks it up the moment you open it.</p>
          </div>
        )}

        {isMac ? (
          <>
            <div className="mt-7">
              <a
                href={dmgUrl}
                onClick={() => setDownloaded(true)}
                className="inline-flex items-center gap-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 transition-colors px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/20"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M12 3v10.55M12 13.55 8.5 10M12 13.55 15.5 10M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {downloaded ? 'Download again' : 'Download for macOS'}
              </a>
              <p className="mt-2 text-xs text-ink-500">Free · macOS 12+ · signed &amp; notarized by Apple</p>
            </div>

            <ol className="mt-8 space-y-4">
              {[
                ['Open the download', 'Double-click Implexa.dmg, then drag Implexa into Applications.'],
                ['Launch Implexa', 'Open it from Applications. Sign in with this same account.'],
                ['You’re in', 'The app connects your Claude or Codex and picks up where you left off — this page jumps you to your dashboard automatically.'],
              ].map(([t, d], i) => (
                <li key={i} className="flex gap-3.5">
                  <span className="shrink-0 mt-0.5 h-6 w-6 rounded-full bg-ink-800 text-ink-300 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-ink-100">{t}</p>
                    <p className="text-sm text-ink-500">{d}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-9 flex items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-3">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brand-500/25 border-t-brand-500 animate-spin" aria-hidden="true" />
              <p className="text-sm text-ink-400">Waiting for you to open the app — this unlocks the moment it connects.</p>
            </div>
          </>
        ) : (
          <div className="mt-7 rounded-lg border border-ink-800 bg-ink-900/40 px-5 py-5">
            <p className="text-sm text-ink-200 font-medium">The desktop app is macOS-only right now.</p>
            <p className="mt-1.5 text-sm text-ink-400">
              On Windows or Linux you can still connect your Claude or Codex with one command — paste this into your terminal:
            </p>
            <button
              type="button"
              onClick={copyCurl}
              className="mt-3 w-full text-left rounded-md bg-ink-950 border border-ink-700 px-3 py-2.5 font-mono text-xs text-ink-100 hover:border-ink-600 transition-colors"
            >
              {copied ? '✓ Copied' : CONNECT_CURL}
            </button>
            <p className="mt-3 text-xs text-ink-500">
              Want the Mac app the day it ships for your platform?{' '}
              <a href="mailto:hello@implexa.ai?subject=Desktop%20app%20waitlist" className="text-brand-500 hover:underline">Join the waitlist</a>.
            </p>
          </div>
        )}

        {/* Escape hatch for power users / Codex / CLI — never the headline. */}
        <details className="mt-8 group">
          <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-300 select-none">
            Prefer to connect via the terminal instead?
          </summary>
          <div className="mt-3 rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-3">
            <p className="text-sm text-ink-400">One command connects Implexa to your existing Claude Code or Codex:</p>
            <button
              type="button"
              onClick={copyCurl}
              className="mt-2 w-full text-left rounded-md bg-ink-950 border border-ink-700 px-3 py-2.5 font-mono text-xs text-ink-100 hover:border-ink-600 transition-colors"
            >
              {copied ? '✓ Copied' : CONNECT_CURL}
            </button>
            <p className="mt-2 text-xs text-ink-500">Full options on the <a href="/install" className="text-brand-500 hover:underline">install page</a>.</p>
          </div>
        </details>
      </div>
    </main>
  );
}
