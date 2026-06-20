'use client';

/**
 * <AgentFeedback /> — "Change how this agent works" (the PERMANENT-change box).
 *
 * One of the two distinct input concepts on an agent:
 *  - FEEDBACK (this component): a PERMANENT change to the agent definition — it
 *    applies to EVERY future run. (The other is the per-run note in the Run-now
 *    pop-up, which steers a single run and never touches the agent.)
 *
 * Hands-off, app-first — like Run / Approve & finish. Submitting enqueues a
 * kind='revise' run-request (POST /api/v2/me/run-requests) carrying the agent and
 * the feedback as the `note`. The always-on drainer picks it up and applies the
 * change via revise_workflow on the user's own Claude/Codex — no session to open.
 * We confirm in place rather than bouncing the user into Claude.
 *
 * For agents with NO setup questions this is the main Setup-tab content, so its
 * clarity matters most: the heading + subtext must make "permanent" unmissable.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export default function AgentFeedback({ slug }: { slug: string; name?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const supabase = createClient();

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // kind='revise' = a PERMANENT change to the agent. The drainer reads the
      // feedback (note) and applies it via revise_workflow, so every future run
      // uses the new steps. Distinct from the per-run note (kind='run' note).
      await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: { workflowSlug: slug, source: 'dashboard', kind: 'revise', note: t },
      });
      setDone(true);
      setText('');
      setMsg('Claude will update this agent hands-off — it applies to every future run. Watch Alerts if it needs a permission.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not send the change. Try again.');
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-2xl w-full rounded-lg border border-success-500/30 bg-success-500/5 p-3">
        <p className="text-xs text-success-600 dark:text-success-400 leading-relaxed">{msg}</p>
        <button
          type="button"
          onClick={() => { setDone(false); setOpen(false); setMsg(''); }}
          className="mt-2 text-xs text-ink-500 hover:text-ink-300"
        >
          Suggest another change
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-ink-400 hover:text-ink-200 underline underline-offset-2"
      >
        Change how this agent works →
      </button>
    );
  }

  return (
    <div className="max-w-2xl w-full rounded-lg border border-ink-700 bg-ink-900/40 p-3">
      <p className="text-sm font-medium text-ink-100">Change how this agent works</p>
      <p className="text-xs text-ink-400 mt-0.5 mb-2.5">
        Applies to <span className="text-ink-200">every future run</span> — this permanently updates the agent.
      </p>
      <label className="block text-xs text-ink-300 mb-1.5">
        What should this agent do differently? (e.g. &ldquo;ask which file is the raw video and let me pick it&rdquo;)
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Describe the change…"
        className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className={sending || !text.trim() ? 'btn-outline text-xs px-3 py-1.5 opacity-50 cursor-not-allowed' : 'btn-success text-xs px-3 py-1.5'}
        >
          {sending ? 'Sending…' : 'Update the agent'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-500 hover:text-ink-300">
          Cancel
        </button>
        {msg && <span className="text-xs text-ink-300">{msg}</span>}
      </div>
      <p className="mt-2.5 text-[11px] text-ink-500 leading-relaxed">
        This agent also learns automatically from each run — use this only to change it on purpose.
        To steer just one run, use the note in “Run now” instead.
      </p>
    </div>
  );
}
