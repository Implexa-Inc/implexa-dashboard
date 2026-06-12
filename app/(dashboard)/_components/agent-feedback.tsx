'use client';

/**
 * <AgentFeedback /> — "or have feedback? type here" (founder request).
 *
 * When an agent's questions are wrong, or the user wants a change before they
 * run it, there was nowhere to say so without leaving the flow. This collapses
 * to a one-line prompt; expanded, it hands the feedback to Claude Code with the
 * intent to FIX the agent and run it. Inside the desktop app it opens Claude
 * with the message prefilled (the user reviews + sends); in a plain browser it
 * copies the message and tells them to paste it. Presence, never runtime.
 */

import { useState } from 'react';

type DesktopBridge = {
  handoffAgent?: (prompt: string, surface?: string, target?: string) => Promise<{ ok: boolean; mode?: string }>;
};
function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { implexaDesktop?: DesktopBridge }).implexaDesktop;
  return b && typeof b.handoffAgent === 'function' ? b : null;
}

export default function AgentFeedback({ slug, name }: { slug: string; name?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setMsg('');
    // Tell Claude to change the agent AND run it, with the feedback verbatim.
    const prompt = `My Implexa agent "${name || slug}" needs a change before it runs. Here's my feedback: ${t}. Please update the agent (revise its steps or the questions it asks) and then run it.`;
    try { await navigator.clipboard.writeText(prompt); } catch { /* best effort */ }
    const bridge = desktopBridge();
    if (bridge?.handoffAgent) {
      const r = await bridge.handoffAgent(prompt, undefined, 'code').catch(() => null);
      setMsg(r?.ok ? 'Opening Claude Code with your feedback — review it and hit enter.' : 'Copied. Open Claude Code and paste it.');
    } else {
      setMsg('Copied. Open your Claude or Codex and paste it to apply the change.');
    }
    setSending(false);
    setText('');
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-ink-400 hover:text-ink-200 underline underline-offset-2"
      >
        Or have feedback? Tell Claude to change it →
      </button>
    );
  }

  return (
    <div className="max-w-2xl w-full rounded-lg border border-ink-700 bg-ink-900/40 p-3">
      <label className="block text-xs text-ink-300 mb-1.5">
        What should this agent do differently? (e.g. &ldquo;ask which file is the raw video and let me pick it&rdquo;)
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Type your feedback…"
        className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className={sending || !text.trim() ? 'btn-outline text-xs px-3 py-1.5 opacity-50 cursor-not-allowed' : 'btn-success text-xs px-3 py-1.5'}
        >
          {sending ? 'Opening…' : 'Send to Claude'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-500 hover:text-ink-300">
          Cancel
        </button>
        {msg && <span className="text-xs text-ink-300">{msg}</span>}
      </div>
    </div>
  );
}
