'use client';

/**
 * <RunContinueBox /> — the UNIVERSAL "Continue / update this run with a prompt + files".
 *
 * Available on ANY run (held, needs-more-inputs, or finished). The user adds
 * instructions/feedback, optionally attaches files, and hits "Continue & re-run".
 * It queues a kind='continue' run-request (POST /api/v2/me/run-requests) carrying
 * the prompt + attached absolute paths in `note`. The always-on drainer loads the
 * prior deliverable (get_run), DOES WHAT THE PROMPT ASKS using it as the starting
 * point, and records an UPDATED result linked to the original — hands-off, landing
 * in the inbox. No Claude session to open.
 *
 * This unifies three cases:
 *   1. approve & ship a held deliverable (leave the prompt empty, or say "ship it"),
 *   2. supply the missing inputs a run needs to finish (e.g. a reel held for approval
 *      AND waiting on captured footage + 2 decisions — "approve" alone would wrongly
 *      ship an incomplete deliverable; here you attach the footage + state the calls),
 *   3. iterate on a finished run's output ("make the hook punchier, re-render").
 *
 * The file-attach affordance + note composition are shared with the run-setup
 * pop-up (./run-attachments, task_4efaa026's pickFile bridge).
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend, BackendError } from '@/lib/api';
import { runRequestRefusalCopy, classifyRunRequestRefusal, type RunRequestRefusal } from '@/lib/run-request-refusal';
import ReviewContinuationRecovery from './review-continuation-recovery';
import { AttachFiles, composeNoteWithFiles, useRunAttachments } from './run-attachments';
import CapabilityCard, { type CapabilityCardData } from './capability-card';
import Modal from './modal';

export default function RunContinueBox({
  runId, agentName, pending = false, initialNote = '',
}: {
  runId: string;
  agentName: string;
  /** Run is held at an approval gate — tunes only the copy (it's still a continue). */
  pending?: boolean;
  /** Optional evidence-grounded repair prompt from Implexa Judge. User reviews it before queueing. */
  initialNote?: string;
}) {
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState('');
  // The pre-run capability ask — a continue runs the agent just like a Run does, so
  // it hits the same gate and deserves the same actionable card rather than an error.
  const [capCard, setCapCard] = useState<CapabilityCardData | null>(null);
  // A Review Room revision that could not be queued is not an error message —
  // it is a state with an action. Holding the typed refusal (rather than only
  // its sentence) is what lets the recovery panel below offer that action.
  const [refusal, setRefusal] = useState<RunRequestRefusal | null>(null);
  const { files, canAttach, canAttachFolder, attachFile, attachFolder, removeFile, error: attachError } = useRunAttachments();
  const supabase = createClient();

  const canSubmit = !!note.trim() || files.length > 0;

  async function submit(opts?: { force?: boolean }) {
    if (busy || !canSubmit) return;
    setBusy(true);
    setMsg('');
    setCapCard(null);
    setRefusal(null);
    try {
      // The prompt + any attached file PATHS, combined into the one-off note the
      // run-request carries (read back by the drainer from the request's `intent`).
      const composed = composeNoteWithFiles(note, files);
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: {
          kind: 'continue', runId, note: composed, source: 'dashboard',
          ...(opts?.force ? { force: true } : {}),
        },
      });
      // `done` is set ONLY here, from a successful response. A refusal below
      // leaves the composer exactly as it was — including every character of the
      // user's note, which is the one thing they must never have to retype.
      setDone(true);
      setMsg('Queued — continuing this run hands-off; the updated result lands in your inbox.');
    } catch (e) {
      const cap = e instanceof BackendError && e.status === 409 ? e.body?.needsCapability : null;
      if (cap) { setCapCard(cap as CapabilityCardData); return; }
      const classified = classifyRunRequestRefusal(e);
      // A recoverable refusal hands off to the panel, which owns the copy AND
      // the action. Showing the sentence here as well would say the same thing
      // twice and still leave the user with nowhere to click.
      if (classified?.recoverable) { setRefusal(classified); setMsg(''); return; }
      setMsg(runRequestRefusalCopy(e, 'Could not queue the continue. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="text-xs text-success-600 dark:text-success-400">{msg}</p>;
  }

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
      <div className="text-sm font-semibold text-ink-100">
        {pending ? 'Continue with changes or the missing inputs' : 'Continue this run'}
      </div>
      <p className="text-xs text-ink-400 mt-0.5 leading-relaxed">
        Add instructions, feedback, or the inputs it still needs{canAttach ? ' (attach files too)' : ''} — it picks up
        from this run&apos;s output and produces an updated result for <span className="text-ink-200">{agentName}</span>, hands-off.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Add instructions, feedback, or the missing inputs…"
        className="mt-3 w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
      />
      <AttachFiles
        files={files}
        canAttach={canAttach}
        canAttachFolder={canAttachFolder}
        onAttach={attachFile}
        onAttachFolder={attachFolder}
        onRemove={removeFile}
        error={attachError}
        hint="A screenshot, the captured footage, a doc — the run reads it as input."
      />
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          // Arrow, not a bare `submit`: onClick passes the MouseEvent as the first
          // arg, which would land in `opts` and make `opts.force` a live tripwire.
          onClick={() => submit()}
          disabled={busy || !canSubmit}
          className="btn-success text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? 'Queuing…' : 'Continue & re-run'}
        </button>
        {msg && <span className="text-xs text-rose-600 dark:text-rose-400">{msg}</span>}
      </div>
      {/* The typed recovery surface. It renders only for a refusal that HAS a
          recovery path, and it never shows Queued unless the backend said so.

          DELIBERATELY NO NOTE (REV-COR04): the panel's action is "retry the
          submitted revision", which replays the immutable submitted round exactly.
          This composer's live text is a NEW instruction — it belongs to a new
          continue, not smuggled into a retry that promises exact reuse. The text
          stays in the box either way; nothing is lost. */}
      {refusal?.recoverable && refusal.requestId && (
        <ReviewContinuationRecovery
          requestId={refusal.requestId}
          refusal={refusal}
          onQueued={() => {
            setDone(true);
            setMsg('Queued with your original review submission — the updated result lands in your inbox.');
          }}
        />
      )}
      {/* Modal, not inline — same call as agent-actions.tsx: a rare gate shouldn't
          push the surrounding layout around every time it fires. */}
      <Modal
        open={!!capCard}
        onClose={() => setCapCard(null)}
        title={capCard?.label ? `${capCard.label} needed` : 'One thing before this runs'}
      >
        {capCard && (
          <CapabilityCard
            card={capCard}
            onRetry={(o) => submit(o)}
          />
        )}
      </Modal>
    </div>
  );
}
