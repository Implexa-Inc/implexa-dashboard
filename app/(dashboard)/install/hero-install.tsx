'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

/**
 * Hero install card — the primary CTA on /install.
 *
 * Two modes based on whether the user already has an install:
 *
 *   1. NO install yet → big "★ Recommended" install card with one-line curl
 *      (tokenized for instant install — the script redeems for an API key
 *      so the user skips the browser Approve roundtrip).
 *
 *   2. Existing install → "✓ Connection active on Claude Code" banner with
 *      install metadata (name + last-active relative time), THEN the install
 *      card framed as "install on another device / re-install".
 *
 * Tokenized curl freshness:
 *   The server-side page mint gave us a token with a 10-min TTL. Keeping the
 *   tab open longer than that would normally make the displayed token expire.
 *   We solve this by refreshing the token on every Copy click — fetch a fresh
 *   token, update state, copy the new value. Guarantees the value the user
 *   pastes is always valid, regardless of how long the page has been open.
 *
 *   If the refresh fails (network blip, backend down), we fall back to the
 *   universal `curl install.sh | bash` line. Same outcome, just with an
 *   extra Approve hop in the browser.
 *
 * Codex support (added 2026-05-27):
 *   The same install token works for both runtimes — only the script URL
 *   differs. We show Claude Code as the primary path (★ Recommended) and
 *   Codex as a parallel install card right below. Both use the same token
 *   refresh logic. Either install gives the user the same skill library +
 *   slash commands + MCP tool surface.
 */
export default function HeroInstall({
  initialInstallCurl,
  initialInstallCurlCodex,
  hasKey,
  keyPrefix,
  installName,
  lastConnected,
}: {
  initialInstallCurl:      string | null;
  initialInstallCurlCodex: string | null;
  hasKey:                  boolean;
  keyPrefix:               string | null;
  installName:             string | null;
  lastConnected:           string | null;
}) {
  // Fallback used when the tokenized variant isn't available (mint failed
  // server-side, or refresh-on-copy failed). The install script handles
  // both — when run without a token, it kicks off the device-auth flow.
  const UNIVERSAL_CURL       = 'curl -fsSL https://core.implexa.ai/install.sh | bash';
  const UNIVERSAL_CURL_CODEX = 'curl -fsSL https://core.implexa.ai/install-for-codex.sh | bash';

  const [installCurl, setInstallCurl]           = useState<string | null>(initialInstallCurl);
  const [installCurlCodex, setInstallCurlCodex] = useState<string | null>(initialInstallCurlCodex);

  /**
   * Mint a fresh install token + update BOTH curl variants. Returns the
   * runtime-specific curl, or null on failure (caller falls back to the
   * universal command). One token, two URLs — same auth, different scripts.
   */
  async function refreshInstallCurls(runtime: 'claude' | 'codex'): Promise<string | null> {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return null;
      const resp = await callBackend('/api/v2/install-tokens', {
        jwt:    session.access_token,
        method: 'POST',
      });
      if (!resp?.token) return null;
      const apiBase = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');
      const freshClaude = `curl -fsSL "${apiBase}/install.sh?t=${resp.token}" | bash`;
      const freshCodex  = `curl -fsSL "${apiBase}/install-for-codex.sh?t=${resp.token}" | bash`;
      setInstallCurl(freshClaude);
      setInstallCurlCodex(freshCodex);
      return runtime === 'codex' ? freshCodex : freshClaude;
    } catch (_) {
      return null;
    }
  }

  // The hero command we display + copy. Always the freshest tokenized one
  // when available, falls back to the universal command.
  const heroCmd      = installCurl || UNIVERSAL_CURL;
  const heroCmdCodex = installCurlCodex || UNIVERSAL_CURL_CODEX;
  const isTokenized  = !!installCurl;

  return (
    <section className="mb-10">
      {/* ── Connection-active banner (only when user already has an install) ── */}
      {hasKey && (
        <ConnectionActiveBanner
          installName={installName}
          keyPrefix={keyPrefix}
          lastConnected={lastConnected}
        />
      )}

      <div className="card !p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-ink-800 text-ink-400">
            Advanced · terminal
          </span>
          <span className="text-xs text-ink-400">
            {hasKey
              ? 'Install on another device or re-install on this one'
              : 'Prefer the terminal? Connect Claude Code or Codex with one command. The app above is the simpler path.'}
          </span>
        </div>

        <div className="rounded-md border border-ink-700 bg-ink-950 px-4 py-3 mb-3 flex items-center gap-3">
          {/* Shell pill — visual cue this is a terminal command. No chevron
           * (we don't offer brew yet — adding ▾ implies a dropdown that
           * doesn't exist). Just a label. */}
          <span className="hidden sm:inline text-[11px] text-ink-400 px-2 py-1 rounded bg-ink-800 border border-ink-700 font-mono shrink-0">
            curl
          </span>
          {/* hide-scrollbar — hides the scrollbar track visually while keeping
           * the horizontal-scroll behavior so long URLs are still reachable.
           * Defined in app/globals.css. */}
          <code className="flex-1 text-sm text-ink-100 font-mono overflow-x-auto whitespace-nowrap hide-scrollbar">
            {heroCmd}
          </code>
          <HeroCopyButton refreshFn={() => refreshInstallCurls('claude')} fallback={UNIVERSAL_CURL} />
        </div>

        <p className="text-sm text-ink-200 leading-relaxed">
          Paste in your terminal. The script auto-installs everything:{' '}
          <strong className="text-ink-100">API key, hooks, the Implexa plugin, MCP wiring.</strong>{' '}
          {isTokenized
            ? <>The link contains a single-use token tied to your account — refreshes automatically when you click Copy.</>
            : <>Your browser opens to approve; once you click Approve, the terminal finishes the rest.</>}
        </p>
        <p className="text-xs text-ink-400 mt-2">Works on macOS, Linux, and Windows (WSL).</p>
      </div>

      {/* ── Codex parallel install card ────────────────────────────────
       * Same token system, different script URL. Sized smaller than the
       * Claude Code card to signal "parallel option, not afterthought."
       * Added 2026-05-27 after homepage pivoted to runtime-agnostic
       * "find + run inline" positioning and the welcome flow needed
       * to advertise both runtimes equally. */}
      <div className="card !p-5 mt-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-ink-700 text-ink-200">
            also supported
          </span>
          <span className="text-xs text-ink-400">
            Codex (CLI) — same library, same wedge, same one command
          </span>
        </div>

        <div className="rounded-md border border-ink-700 bg-ink-950 px-4 py-3 mb-3 flex items-center gap-3">
          <span className="hidden sm:inline text-[11px] text-ink-400 px-2 py-1 rounded bg-ink-800 border border-ink-700 font-mono shrink-0">
            curl
          </span>
          <code className="flex-1 text-sm text-ink-100 font-mono overflow-x-auto whitespace-nowrap hide-scrollbar">
            {heroCmdCodex}
          </code>
          <HeroCopyButton refreshFn={() => refreshInstallCurls('codex')} fallback={UNIVERSAL_CURL_CODEX} />
        </div>

        <p className="text-xs text-ink-400 leading-relaxed">
          Writes to <code className="bg-ink-800 px-1 rounded">~/.codex/config.toml</code> instead of Claude Code's dotfiles.{' '}
          Same install token works for both — install once on each runtime you use.
        </p>
      </div>

      {/* After-install commands — runtime-agnostic where possible. The
       * wedge command (/implexa:run) is the single most important first
       * action; it sells the entire product in one keystroke. Keep it
       * literally as the third line so the user sees it on every visit. */}
      <div className="mt-5 pl-1 space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-ink-400 font-medium">After install</p>
        <NextStepLine prefix="Launch your runtime"     cmd="claude   (or: codex)" />
        <NextStepLine prefix="Verify you're connected" cmd="/implexa:setup" />
        <NextStepLine prefix="Try your first skill"    cmd='/implexa:run "draft a cold outreach email"' />
      </div>
    </section>
  );
}

/**
 * Big celebratory banner shown when the user already has an active install.
 * Doesn't replace the install card below — they may still want to install
 * on another device. Just reframes the visit ("you're connected, here's
 * the command for elsewhere") instead of treating them like a new user.
 */
function ConnectionActiveBanner({
  installName,
  keyPrefix,
  lastConnected,
}: {
  installName:   string | null;
  keyPrefix:     string | null;
  lastConnected: string | null;
}) {
  const lastConnectedDisplay = lastConnected ? timeSince(new Date(lastConnected)) : null;

  return (
    <div className="card !p-5 mb-6 !bg-gradient-to-r !from-success-400/15 !to-brand-500/5 !border-success-400/40">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-success-400/20 border border-success-400/50 flex items-center justify-center text-success-700 dark:text-success-400 text-sm font-bold shrink-0">
          ✓
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-ink-50 leading-tight">
            Your connection is active
          </h2>
          <div className="text-xs text-ink-300 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {installName && <span>Install: <strong className="text-ink-100">{installName}</strong></span>}
            {lastConnectedDisplay && <span>Last active {lastConnectedDisplay}</span>}
            {keyPrefix && <span className="font-mono text-ink-400">imp_live_{keyPrefix}…</span>}
          </div>
          <p className="text-xs text-ink-300 mt-3 leading-relaxed">
            See more installation options below — install on another device, install on Codex, or wire up Cowork / Chat / the Desktop UI.
          </p>
        </div>
      </div>
    </div>
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

/**
 * Hero copy button — refreshes the install token before copying. If the
 * refresh fails (network blip, backend down), falls back to copying the
 * universal `curl install.sh | bash` command so the user still gets a
 * working install path.
 */
function HeroCopyButton({
  refreshFn,
  fallback,
}: {
  refreshFn: () => Promise<string | null>;
  fallback:  string;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function copy() {
    if (busy || typeof navigator === 'undefined') return;
    setBusy(true);
    let toCopy = await refreshFn();
    if (!toCopy) toCopy = fallback;
    try {
      await navigator.clipboard?.writeText(toCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={busy}
      className={`shrink-0 inline-flex items-center justify-center rounded transition-colors text-[10px] uppercase tracking-wider font-medium px-3 py-1.5 ${
        copied
          ? 'bg-success-400/20 text-success-700 dark:text-success-400'
          : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100 border border-ink-700 disabled:opacity-50'
      }`}
      aria-label="Copy command"
    >
      {busy ? '…' : copied ? '✓' : 'Copy'}
    </button>
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

function timeSince(d: Date) {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}
