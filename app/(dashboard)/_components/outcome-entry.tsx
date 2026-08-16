'use client';

/**
 * The outcome-first entry on /create (Build & Rent): state the result you
 * need — with constraints, budget, and optional files — and Implexa's control
 * plane proposes a deterministic plan you can inspect before anything runs.
 *
 * Division of authority, deliberately narrow:
 *   - This surface COLLECTS the outcome request and DISPLAYS the server's
 *     prepared plan. Selection, ranking, budgets, and plan identity live in
 *     the backend; the browser never picks an agent and never computes a cost.
 *   - Start posts the plan id + digest VERBATIM — the backend refuses a stale
 *     or altered plan. Editing any field discards the shown plan, because a
 *     plan for the old request must not look startable for the new one.
 *   - Every failure is fail-closed and says so: an unreadable planner answer
 *     renders "we can't plan this right now", which is not the same claim as
 *     "no eligible agent" (an explicit, contracted answer the backend signed
 *     off on).
 *
 * Attachments travel as names + sizes only — declared inputs for planning,
 * never file bytes through this box.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  OUTCOME_QUALITIES, parsePlanResponse,
  type OutcomeQuality, type PlanOutcome,
} from '@/lib/outcome-production';
import OutcomePlanCard from './outcome-plan-card';

type Attachment = { name: string; sizeBytes: number };

type PlanPhase =
  | { phase: 'idle' }
  | { phase: 'planning' }
  | { phase: 'plan'; outcome: PlanOutcome; idempotencyKey: string }
  | { phase: 'invalid'; message: string }
  | { phase: 'unavailable'; message: string };

const UNAVAILABLE_COPY = 'We can’t plan this outcome right now. Nothing was selected and nothing will run — this is not the same as having no eligible agent.';

/**
 * The start landed or it didn't, and from here we cannot tell which. The one
 * safe move is to press Start again: it reuses this plan's idempotency key, so
 * a start that already succeeded is recognised rather than repeated. Telling
 * the user to plan again would mint a NEW plan and key, and if the first start
 * had in fact landed they would reserve the budget a second time.
 */
const UNCONFIRMED_START_COPY = 'We couldn’t confirm the start. Press Start production again — it reuses this plan’s approval, so it cannot reserve your budget twice.';

/** Declared inputs the planner is allowed to see in one request. */
const MAX_ATTACHMENTS = 10;

export default function OutcomeEntry() {
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [quality, setQuality] = useState<OutcomeQuality>('balanced');
  const [deadline, setDeadline] = useState('');
  const [budgetDollars, setBudgetDollars] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [plan, setPlan] = useState<PlanPhase>({ phase: 'idle' });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [droppedFiles, setDroppedFiles] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // The generation of the request currently on screen. Bumped by every edit AND
  // by every plan request, so an answer computed for a superseded request is
  // DROPPED rather than rendered ([[plan-review-modal reqId]]).
  //
  // Clearing the plan on edit is not sufficient on its own: the clear happens
  // now, the in-flight response lands later, and without this guard it would
  // repaint a plan built from the old goal/budget — startable, with a genuine
  // digest the backend would honour, against a ceiling the user had already
  // changed.
  const reqId = useRef(0);

  // A shown plan is bound to the request that produced it. Any edit discards
  // it — the stale digest would be refused server-side anyway, but the UI must
  // not present last request's plan as this request's.
  function edit<T>(set: (v: T) => void) {
    return (value: T) => {
      reqId.current += 1;
      set(value);
      setPlan((current) => (current.phase === 'idle' ? current : { phase: 'idle' }));
      setStartError(null);
      // addFiles re-sets this AFTER calling us, so its own count survives.
      setDroppedFiles(0);
    };
  }
  const editGoal = edit(setGoal);
  const editQuality = edit(setQuality);
  const editDeadline = edit(setDeadline);
  const editBudget = edit(setBudgetDollars);
  const editAttachments = edit(setAttachments);

  const budgetCents = Math.round(Number(budgetDollars) * 100);
  const requestReady = goal.trim().length >= 8 && Number.isInteger(budgetCents) && budgetCents >= 100;

  async function requestPlan() {
    const mine = (reqId.current += 1);
    const current = () => mine === reqId.current;
    setPlan({ phase: 'planning' });
    setStartError(null);
    try {
      const res = await fetch('/api/outcome-productions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'plan',
          goal: goal.trim(),
          quality,
          maxBudgetCents: budgetCents,
          deadline: deadline || null,
          attachments,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!current()) return;
      if (res.status === 400 || res.status === 401) {
        setPlan({ phase: 'invalid', message: (body && typeof body.error === 'string' && body.error) || 'That request was refused.' });
        return;
      }
      const outcome = res.ok ? parsePlanResponse(body) : null;
      if (!outcome) {
        setPlan({ phase: 'unavailable', message: UNAVAILABLE_COPY });
        return;
      }
      // One idempotency key per shown plan: a retried Start can never reserve
      // the budget twice.
      setPlan({ phase: 'plan', outcome, idempotencyKey: crypto.randomUUID() });
    } catch {
      if (current()) setPlan({ phase: 'unavailable', message: UNAVAILABLE_COPY });
    }
  }

  async function startProduction() {
    if (plan.phase !== 'plan' || plan.outcome.kind !== 'plan') return;
    const mine = reqId.current;
    const current = () => mine === reqId.current;
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/outcome-productions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          planId: plan.outcome.plan.id,
          planDigest: plan.outcome.plan.digest,
          idempotencyKey: plan.idempotencyKey,
        }),
      });
      const body = await res.json().catch(() => null);
      const productionId = res.ok && body && body.ok === true && typeof body.productionId === 'string' ? body.productionId : null;
      // A production that really started is worth navigating to even if the
      // user edited the form meanwhile — the money is committed either way.
      if (productionId) {
        router.push(`/runs/productions/${productionId}`);
        return;
      }
      if (!current()) return;
      if (res.status === 409) {
        // The backend refused the plan identity (stale, expired, or budget
        // moved). The shown plan is no longer real — discard it, and say so
        // in the standing status region (the card it rendered in is gone).
        setPlan({ phase: 'invalid', message: 'That plan is no longer current. Plan again to get a fresh one.' });
      } else {
        setStartError(UNCONFIRMED_START_COPY);
      }
    } catch {
      if (current()) setStartError(UNCONFIRMED_START_COPY);
    } finally {
      if (current()) setStarting(false);
    }
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = [...attachments];
    let dropped = 0;
    for (const file of Array.from(files)) {
      if (next.some((a) => a.name === file.name && a.sizeBytes === file.size)) continue;
      // Silently narrowing the declared input set is the one thing the user
      // cannot detect: the plan would be built from fewer inputs than they
      // believe they supplied, and its reasons would look sound.
      if (next.length >= MAX_ATTACHMENTS) { dropped += 1; continue; }
      next.push({ name: file.name, sizeBytes: file.size });
    }
    editAttachments(next);
    setDroppedFiles(dropped);
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <div className="card p-6 sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-ink-50">State the outcome</h2>
      <p className="text-sm text-ink-400 mt-1.5">
        Describe the result you need. Implexa picks from your installed, ready agents — deterministically —
        and shows you the plan, the reasons, and the cost ceiling before anything starts.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="outcome-goal" className="block text-sm font-medium text-ink-200">
            What outcome do you need?
          </label>
          <textarea
            id="outcome-goal"
            value={goal}
            onChange={(e) => editGoal(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="e.g. Use my approved video sections and editable project to produce a high-quality final master."
            className="mt-1.5 w-full rounded-lg bg-ink-900 border border-ink-700 px-4 py-3 text-[15px] text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-ink-500"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-ink-200">Files this outcome starts from</span>
          <p className="text-xs text-ink-500 mt-0.5">Optional. Names and sizes declare your inputs for planning; file bytes never travel through this box.</p>
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {attachments.map((a) => (
                <li key={`${a.name}-${a.sizeBytes}`} className="flex items-center gap-2 text-xs text-ink-300">
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => editAttachments(attachments.filter((x) => !(x.name === a.name && x.sizeBytes === a.sizeBytes)))}
                    className="text-ink-500 hover:text-ink-200"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileInput}
            id="outcome-attachments"
            type="file"
            multiple
            onChange={(e) => addFiles(e.target.files)}
            className="mt-2 block text-xs text-ink-400 file:mr-3 file:rounded-lg file:border file:border-ink-700 file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:text-ink-300"
            aria-label="Attach files this outcome starts from"
          />
          {droppedFiles > 0 && (
            <p role="status" className="mt-2 text-xs text-amber-300">
              {droppedFiles} {droppedFiles === 1 ? 'file was' : 'files were'} not added — one outcome request declares at most {MAX_ATTACHMENTS} inputs.
              Remove something above if a dropped file matters to this outcome.
            </p>
          )}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ink-200">Quality</legend>
          <div className="mt-1.5 grid sm:grid-cols-3 gap-2">
            {OUTCOME_QUALITIES.map((option) => (
              <label
                key={option.value}
                className={`rounded-lg border px-3 py-2.5 cursor-pointer ${quality === option.value ? 'border-brand-500 bg-brand-500/5' : 'border-ink-700 hover:border-ink-500'}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="outcome-quality"
                    value={option.value}
                    checked={quality === option.value}
                    onChange={() => editQuality(option.value)}
                  />
                  <span className="text-sm text-ink-100">{option.label}</span>
                </span>
                <span className="block text-xs text-ink-500 mt-1">{option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="outcome-deadline" className="block text-sm font-medium text-ink-200">
              Deadline <span className="text-ink-500 font-normal">(optional)</span>
            </label>
            <input
              id="outcome-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => editDeadline(e.target.value)}
              className="mt-1.5 w-full rounded-lg bg-ink-900 border border-ink-700 px-4 py-2.5 text-sm text-ink-50 focus:outline-none focus:border-ink-500"
            />
          </div>
          <div>
            <label htmlFor="outcome-budget" className="block text-sm font-medium text-ink-200">
              Maximum budget (USD)
            </label>
            <input
              id="outcome-budget"
              type="number"
              min={1}
              max={5000}
              step={1}
              value={budgetDollars}
              onChange={(e) => editBudget(e.target.value)}
              placeholder="40"
              className="mt-1.5 w-full rounded-lg bg-ink-900 border border-ink-700 px-4 py-2.5 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-ink-500"
            />
            <p className="text-xs text-ink-500 mt-1">A hard ceiling. Production stops before exceeding it.</p>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={requestPlan}
            disabled={!requestReady || plan.phase === 'planning'}
            className="rounded-lg bg-brand-500 text-ink-950 px-6 py-3 text-sm font-medium hover:bg-brand-400 transition-colors disabled:opacity-50"
          >
            {plan.phase === 'planning' ? 'Planning…' : 'Plan this outcome'}
          </button>
          <p className="text-xs text-ink-500 mt-2">
            Planning is free and starts nothing. You approve the plan — and its spend ceiling — before production begins.
          </p>
        </div>
      </div>

      {plan.phase === 'invalid' && (
        <p role="status" className="mt-4 text-sm text-red-400">{plan.message}</p>
      )}

      {plan.phase === 'unavailable' && (
        <div role="status" aria-label="Planning unavailable" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-300">{plan.message}</p>
        </div>
      )}

      {plan.phase === 'plan' && (
        <div className="mt-5">
          <OutcomePlanCard
            outcome={plan.outcome}
            onStart={startProduction}
            starting={starting}
            startError={startError}
          />
        </div>
      )}
    </div>
  );
}
