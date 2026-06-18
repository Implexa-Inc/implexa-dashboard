'use client';

/**
 * <ConnectTelegram /> — Run From Anywhere (Phase 2, S4): bind a Telegram chat.
 *
 * Mints a one-time link code from the backend (GET /api/v2/telegram/link-code)
 * and shows the user how to bind their chat: tap the deep link (or send
 * "/link <code>" to the bot). Once bound, the user can text "run <agent>" or
 * "build an agent that <does X>" from their phone and it runs on their machine.
 *
 * Degrades quietly when the bot isn't configured server-side yet
 * (enabled:false → the whole feature is "coming soon").
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type LinkInfo = { enabled: boolean; code?: string; deepLink?: string | null; botUsername?: string | null };

export default function ConnectTelegram() {
  const supabase = createClient();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function connect() {
    setError(null); setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Session lost — sign in again.'); return; }
      const res = await callBackend('/api/v2/telegram/link-code', { jwt: session.access_token });
      setInfo(res as LinkInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get a link code.');
    } finally {
      setLoading(false);
    }
  }

  async function copyCode() {
    if (!info?.code) return;
    try { await navigator.clipboard.writeText(info.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }

  return (
    <section className="card">
      <h2 className="text-base font-medium text-ink-50 mb-1">Run from your phone (Telegram)</h2>
      <p className="text-xs text-ink-300 mb-4 leading-relaxed">
        Link a Telegram chat and you can text <span className="font-mono text-ink-100">run &lt;agent&gt;</span> or{' '}
        <span className="font-mono text-ink-100">build an agent that …</span> from anywhere. It runs on this
        machine under your own accounts; the result comes back in the chat. Implexa never holds your keys.
      </p>

      {/* Not yet connected */}
      {!info && (
        <button type="button" onClick={connect} disabled={loading} className="btn-primary whitespace-nowrap">
          {loading ? 'Getting your code…' : 'Connect Telegram'}
        </button>
      )}

      {/* Bot not configured server-side */}
      {info && !info.enabled && (
        <p className="text-sm text-ink-300">
          Telegram isn&apos;t switched on for Implexa yet — it&apos;s coming soon. Nothing to do here for now.
        </p>
      )}

      {/* Connected: show the code + deep link */}
      {info && info.enabled && info.code && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-400">Your link code:</span>
            <code className="text-sm font-mono text-ink-50 bg-ink-900/60 border border-ink-700 rounded px-2 py-1 tracking-widest">{info.code}</code>
            <button type="button" onClick={copyCode} className="text-xs text-brand-500 hover:underline">
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>

          {info.deepLink ? (
            <a href={info.deepLink} target="_blank" rel="noreferrer" className="btn-success inline-flex text-sm px-4 py-2">
              Open {info.botUsername ? `@${info.botUsername}` : 'the bot'} in Telegram →
            </a>
          ) : (
            <p className="text-xs text-ink-400 leading-relaxed">
              Open your Implexa bot in Telegram and send <span className="font-mono text-ink-100">/link {info.code}</span> to bind this chat.
            </p>
          )}

          <p className="text-[11px] text-ink-500 leading-relaxed">
            Tapping the button sends <span className="font-mono">/start {info.code}</span> automatically. After it says “Linked”, text{' '}
            <span className="font-mono">run &lt;agent&gt;</span> or <span className="font-mono">build an agent that …</span> anytime.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </section>
  );
}
