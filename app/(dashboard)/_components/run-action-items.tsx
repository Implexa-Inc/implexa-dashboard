'use client';

/**
 * <RunActionItems /> — the proposed FOLLOW-UP ACTIONS for a run (run_actions,
 * migration 0090), surfaced LOUD at the top of the run page.
 *
 * A delivered run often implies several next steps ("Publish the article",
 * "Approve the HeyGen render") that today die as prose in the deliverable's
 * "Holds / Next steps" section. The executing agent now emits them as data; this
 * renders them as one-tap buttons so the user acts without re-reading the markdown.
 *
 * Loud vs quiet (the founder's model):
 *   • READY agent actions → primary green buttons. One tap spawns a hands-off
 *     continue run that does the preset instruction from this deliverable.
 *   • HUMAN actions → first-person acknowledgement buttons ("I posted draft 2").
 *     One tap marks the external step done; it never queues another agent run.
 *   • NEEDS_SETUP actions → shown but muted, with the blocker ("needs the repo
 *     mounted"), since they need the user to enable something first.
 *   • Beyond the top two, the rest collapse under "More actions (N)".
 * Each action has a quiet ✕ to dismiss. The freeform "Continue this run" box
 * lower on the page stays as the escape hatch.
 *
 * Acting calls POST /runs/:id/actions/:actionId/act (spawns the continue/revise
 * run-request + flips the action to 'acting'); dismiss calls .../dismiss.
 */

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export type RunActionItem = {
  id: string;
  kind: 'publish' | 'approve_render' | 'continue' | 'revise' | 'approve' | 'other';
  label: string;
  summary: string | null;
  preset_prompt: string | null;
  fulfillment?: 'agent_run' | 'human_confirm' | null;
  confirmation_label?: string | null;
  readiness: 'ready' | 'needs_setup';
  blocker: string | null;
  confidence: number | null;
  status: 'open' | 'acting' | 'done' | 'dismissed';
  request_id?: string | null;
  linked_request_status?: 'pending' | 'claimed' | 'consumed' | 'done' | 'cancelled' | null;
  linked_request_lifecycle?: string | null;
};

export function isRetryableApprovalAction(a: RunActionItem): boolean {
  return a.kind === 'approve_render'
    && ['acting', 'done'].includes(a.status)
    && a.linked_request_status === 'done'
    && a.linked_request_lifecycle === 'fallback_blocked';
}

function isHumanAction(a: RunActionItem): boolean {
  if (a.fulfillment) return a.fulfillment === 'human_confirm';
  const text = [a.label, a.summary, a.preset_prompt, a.blocker].filter(Boolean).join(' ').toLowerCase();
  return /\b(myself|yourself|manually)\b/.test(text)
    || /\bhuman[ -]action\b/.test(text)
    || /\bcopy (?:and|then) (?:post|send|publish|upload|share)\b/.test(text)
    || /\bopen (?:the )?(?:thread|page|app) and (?:post|send|publish|upload|share)\b/.test(text);
}

function humanConfirmationLabel(a: RunActionItem): string {
  if (a.confirmation_label) return a.confirmation_label;
  const label = a.label.trim()
    .replace(/\s+(?:myself|yourself|manually)\s*$/i, '')
    .replace(/^please\s+/i, '');
  const replacements: Array<[RegExp, string]> = [
    [/^post\b/i, 'I posted'],
    [/^publish\b/i, 'I published'],
    [/^send\b/i, 'I sent'],
    [/^upload\b/i, 'I uploaded'],
    [/^share\b/i, 'I shared'],
    [/^review\b/i, 'I reviewed'],
    [/^approve\b/i, 'I approved'],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(label)) return label.replace(pattern, replacement).slice(0, 120);
  }
  return label ? `I completed: ${label}`.slice(0, 120) : 'I completed this';
}

/**
 * ActionRow lives at MODULE level on purpose. It was previously declared inside
 * RunActionItems, which gave it a new function identity on every parent render —
 * so each keystroke in the setup <textarea> (setNotes → re-render) remounted the
 * whole row, and autoFocus put the caret back at position 0. Every character
 * landed at the front and typed text came out mirrored ("add a web search" →
 * "hcraes sbew a dda"). Keep it top-level so the textarea survives re-renders.
 */
function ActionRow({
  a, busy, actedLine, open, note,
  onPrimaryClick, onAct, onDismiss, onNoteChange, onCloseSetup,
}: {
  a: RunActionItem;
  busy: string | null;
  actedLine: string | undefined;
  open: boolean;
  note: string;
  onPrimaryClick: (a: RunActionItem) => void;
  onAct: (a: RunActionItem) => void;
  onDismiss: (a: RunActionItem) => void;
  onNoteChange: (id: string, value: string) => void;
  onCloseSetup: (id: string) => void;
}) {
  // Queued state is DURABLE: driven by the server status (acting = a continue
  // run-request was spawned), not just local React state — so it survives a
  // refresh. Without this the action re-rendered as a fresh clickable button
  // after reload and looked like the click did nothing (founder hit this).
  // An approve-render action can remain `acting` after its linked request has
  // terminally stopped at the consequential-state fence. The backend owns the
  // idempotent recovery boundary for that exact action, so this is RETRYABLE,
  // not queued. Treating every acting row as live hid the only safe recovery
  // control forever and pushed users toward the generic continuation form.
  const retryableApproval = isRetryableApprovalAction(a);
  const serverQueued = a.status === 'acting' && !retryableApproval;
  const serverDone = a.status === 'done' && !retryableApproval;
  const human = isHumanAction(a);
  const confirmation = actedLine
    || (serverQueued ? `Queued — “${a.label}” runs hands-off. Watch it in Active Agents; the result lands on Home.` : null);
  const ready = a.readiness === 'ready' || human;
  // A done action: show a quiet "done" pill, never a live button.
  if (serverDone && !actedLine) {
    return (
      <div className="flex items-center gap-2 py-2.5">
        <span className="text-sm text-emerald-700 dark:text-emerald-300">✓ {a.label} — done</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPrimaryClick(a)}
            disabled={!!busy || !!confirmation}
            className={`${ready ? 'btn-success' : 'btn-outline'} text-sm px-3.5 py-1.5 disabled:opacity-60`}
          >
            {busy === a.id
              ? (human ? 'Saving…' : 'Queuing…')
              : confirmation
                ? (human ? '✓ Done' : '✓ Queued')
                : retryableApproval
                  ? 'Retry approval'
                  : (human ? humanConfirmationLabel(a) : a.label)}
          </button>
          {human && !confirmation && (
            <span className="text-[10px] uppercase tracking-wide text-ink-500 font-medium">
              human action
            </span>
          )}
          {!ready && !confirmation && (
            <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-medium">
              needs setup
            </span>
          )}
        </div>
        {confirmation ? (
          <div className="mt-1.5">
            <p className="text-xs text-emerald-700 dark:text-emerald-300">{confirmation}</p>
            {!human && (
              <Link href="/workflows" className="mt-1 inline-block text-[11px] text-sky-600 dark:text-sky-400 hover:underline">
                Watch in Active Agents →
              </Link>
            )}
          </div>
        ) : (
          <>
            {retryableApproval ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 leading-snug">
                The previous continuation stopped safely before completing. Retry this approval through the protected recovery path.
              </p>
            ) : a.summary ? <p className="mt-1 text-xs text-ink-400 leading-snug">{a.summary}</p> : null}
            {!ready && a.blocker && <p className="mt-0.5 text-[11px] text-amber-600/90 dark:text-amber-400/80">{a.blocker}</p>}

            {/* needs_setup panel — collect the missing info / confirm setup BEFORE
                queuing, so a blocked action never fires blind. */}
            {!human && !ready && open && (
              <div className="mt-2.5 rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-3">
                <p className="text-[11px] text-ink-300">
                  This needs you to set something up first. Add what it needs below (e.g. the blog slugs, a path,
                  or a note), <span className="text-ink-400">or run it from a session where the setup is in place</span> — then it goes hands-off.
                </p>
                <textarea
                  value={note}
                  onChange={(e) => onNoteChange(a.id, e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder={a.blocker || 'Add the missing inputs or setup notes…'}
                  className="mt-2 w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-2.5 py-1.5 text-ink-100 placeholder:text-ink-600 focus:border-amber-500/50 focus:outline-none resize-y"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button type="button" onClick={() => onAct(a)} disabled={!!busy}
                    className="btn-success text-sm px-3.5 py-1.5 disabled:opacity-60">
                    {busy === a.id ? 'Queuing…' : 'Run it'}
                  </button>
                  <button type="button"
                    onClick={() => onCloseSetup(a.id)}
                    className="text-xs text-ink-500 hover:text-ink-300">Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {!confirmation && (
        <button
          type="button"
          onClick={() => onDismiss(a)}
          disabled={!!busy}
          title="Not needed"
          aria-label="Dismiss this action"
          className="shrink-0 text-ink-600 hover:text-ink-300 text-sm leading-none px-1 pt-2 disabled:opacity-50"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function RunActionItems({ runId, actions }: { runId: string; actions: RunActionItem[] }) {
  const supabase = createClient();
  // Local lifecycle: hide a dismissed action, flip an acted one to a confirmation.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [acted, setActed] = useState<Record<string, string>>({}); // id → confirmation line
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A needs_setup action opens a small panel FIRST (collect the missing info /
  // confirm the setup) instead of firing blind — the founder hit a needs_setup
  // action that "said it needed setup but didn't ask me anything".
  const [setupOpen, setSetupOpen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function jwt() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  async function act(a: RunActionItem) {
    if (busy) return;
    setBusy(a.id); setErr(null);
    try {
      const note = (notes[a.id] || '').trim();
      const result = await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/actions/${encodeURIComponent(a.id)}/act`, {
        jwt: await jwt(), method: 'POST', body: note ? { note } : {},
      });
      if (result?.fulfillment === 'human_confirm' || isHumanAction(a)) {
        setActed((m) => ({ ...m, [a.id]: `Done — ${result?.confirmationLabel || humanConfirmationLabel(a)}.` }));
      } else {
        setActed((m) => ({ ...m, [a.id]: `Queued — “${a.label}” runs hands-off. The result lands on Home.` }));
      }
    } catch {
      setErr(isHumanAction(a) ? 'Could not mark that done. Try again.' : 'Could not queue that. Try again.');
    } finally {
      setBusy(null);
    }
  }

  // Ready → one-tap. needs_setup → reveal the setup panel first; a second click
  // ("Run it") inside the panel actually queues.
  function primaryClick(a: RunActionItem) {
    if (isHumanAction(a)) { act(a); return; }
    if (a.readiness === 'ready') { act(a); return; }
    setSetupOpen((s) => { const n = new Set(s); n.add(a.id); return n; });
  }

  async function dismiss(a: RunActionItem) {
    if (busy) return;
    setBusy(a.id); setErr(null);
    try {
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/actions/${encodeURIComponent(a.id)}/dismiss`, {
        jwt: await jwt(), method: 'POST', body: {},
      });
      setHidden((s) => new Set(s).add(a.id));
    } catch {
      setErr('Could not dismiss. Try again.');
    } finally {
      setBusy(null);
    }
  }

  // Ready first, then needs_setup; within each, higher confidence first.
  const live = actions
    .filter((a) => !hidden.has(a.id))
    .sort((x, y) => {
      const r = (x.readiness === 'ready' ? 0 : 1) - (y.readiness === 'ready' ? 0 : 1);
      return r !== 0 ? r : (y.confidence ?? 0) - (x.confidence ?? 0);
    });
  if (live.length === 0) return null;

  const PRIMARY = 2;
  const primary = showAll ? live : live.slice(0, PRIMARY);
  const moreCount = live.length - PRIMARY;

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink-100">What&apos;s next for this run</h2>
        <span className="text-[11px] text-ink-500">{live.length} action{live.length === 1 ? '' : 's'} identified</span>
      </div>
      <div className="mt-1.5 divide-y divide-ink-800/70">
        {primary.map((a) => (
          <ActionRow
            key={a.id}
            a={a}
            busy={busy}
            actedLine={acted[a.id]}
            open={setupOpen.has(a.id)}
            note={notes[a.id] || ''}
            onPrimaryClick={primaryClick}
            onAct={act}
            onDismiss={dismiss}
            onNoteChange={(id, value) => setNotes((m) => ({ ...m, [id]: value }))}
            onCloseSetup={(id) => setSetupOpen((s) => { const n = new Set(s); n.delete(id); return n; })}
          />
        ))}
      </div>
      {!showAll && moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-ink-500 hover:text-ink-300"
        >
          More actions ({moreCount}) ▾
        </button>
      )}
      {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
    </section>
  );
}
