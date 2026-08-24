'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  OUTCOME_INPUT_TYPES, OUTCOME_QUALITIES, parsePlanResponse,
  type OutcomeInputType, type OutcomeQuality, type PlanOutcome,
} from '@/lib/outcome-production';
import { desktopBridge, type RunInputProgress } from './run-attachments';
import { resolvePickerResult, type ArtifactBinding, type WorkflowInputField } from '@/lib/workflow-input-contract';
import OutcomePlanCard from './outcome-plan-card';
import RunInputVerificationProgress from './run-input-verification-progress';

type VerifiedArtifact = ArtifactBinding & {
  inputSessionId: string;
  inputType: OutcomeInputType;
};

type PlanPhase =
  | { phase: 'idle' }
  | { phase: 'planning' }
  | { phase: 'plan'; outcome: PlanOutcome }
  | { phase: 'invalid'; message: string }
  | { phase: 'unavailable'; message: string };

const UNAVAILABLE_COPY = 'We can’t plan this outcome right now. Nothing was selected and nothing will run — this is not the same as having no eligible agent.';
const UNCONFIRMED_START_COPY = 'We couldn’t confirm the start. Press Start production again to retry the same Backend production and plan digest.';
const MAX_ARTIFACTS = 10;
const MAX_OUTCOME_GOAL = 2000;
const MAX_RUN_INSTRUCTIONS = 2000;

export function canonicalOutcomeText(value: string) {
  // OutcomeIntent.v1 canonicalizes whitespace before digesting. Mirror that
  // normalization for exact response-identity checks.
  return value.replace(/\s+/g, ' ').trim();
}
function pickerField(inputType: OutcomeInputType): WorkflowInputField {
  return {
    key: inputType, label: inputType.replaceAll('_', ' '),
    description: 'A verified artifact this outcome starts from.',
    kind: 'file', required: false, cardinality: 'many', order: 0,
  };
}

export default function OutcomeEntry() {
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [runInstructions, setRunInstructions] = useState('');
  const [plannedRunInstructions, setPlannedRunInstructions] = useState('');
  const [quality, setQuality] = useState<OutcomeQuality>('balanced');
  const [deadline, setDeadline] = useState('');
  const [budgetCredits, setBudgetCredits] = useState('100');
  const [artifactType, setArtifactType] = useState<OutcomeInputType>('presenter_video');
  const [artifacts, setArtifacts] = useState<VerifiedArtifact[]>([]);
  const [plan, setPlan] = useState<PlanPhase>({ phase: 'idle' });
  const [starting, setStarting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [inDesktop, setInDesktop] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [verificationProgress, setVerificationProgress] = useState<RunInputProgress | null>(null);
  const [cancelingVerification, setCancelingVerification] = useState(false);
  const [verificationSurface, setVerificationSurface] = useState<'inputs' | 'plan'>('inputs');
  const [startError, setStartError] = useState<string | null>(null);
  const reqId = useRef(0);
  const inputSessionId = useRef<string | undefined>(undefined);
  const pickerInFlight = useRef(false);
  const pendingInputKey = useRef<string | null>(null);
  const activeVerificationOperation = useRef<string | null>(null);
  const prepareInFlight = useRef<number | null>(null);
  const startInFlight = useRef(false);
  const prepareIdempotencyKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    const bridge = desktopBridge();
    setInDesktop(!!bridge?.pickRunInput);
    if (!bridge?.onRunInputProgress) return;
    const unsubscribe = bridge.onRunInputProgress((progress) => {
      if (!pickerInFlight.current || progress.inputKey !== pendingInputKey.current) return;
      const active = activeVerificationOperation.current;
      if (active && active !== progress.operationId) return;
      if (progress.phase === 'registering') {
        if (active === progress.operationId) setVerificationProgress(null);
        return;
      }
      if (progress.phase !== 'verifying_local' || progress.cancelable !== true) return;
      activeVerificationOperation.current = progress.operationId;
      setVerificationProgress(progress);
    });
    return () => { try { unsubscribe?.(); } catch { /* old Desktop listener */ } };
  }, []);

  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      reqId.current += 1;
      prepareInFlight.current = null;
      prepareIdempotencyKey.current = undefined;
      set(value);
      setPlan((current) => current.phase === 'idle' ? current : { phase: 'idle' });
      setStartError(null);
    };
  }
  const editGoal = edit(setGoal);
  const editQuality = edit(setQuality);
  const editDeadline = edit(setDeadline);
  const editBudget = edit(setBudgetCredits);
  const editArtifacts = edit(setArtifacts);

  const parsedCredits = Number(budgetCredits);
  const requestReady = goal.trim().length >= 8 && Number.isInteger(parsedCredits) && parsedCredits >= 1 && parsedCredits <= 100000;
  const instructionsDirty = canonicalOutcomeText(runInstructions) !== plannedRunInstructions;
  const runInstructionsError = canonicalOutcomeText(runInstructions).length > MAX_RUN_INSTRUCTIONS
    ? `Run instructions must be at most ${MAX_RUN_INSTRUCTIONS.toLocaleString()} characters.`
    : null;

  async function addArtifact(expectedType?: OutcomeInputType, replan = false) {
    if (pickerInFlight.current) return;
    if (artifacts.length >= MAX_ARTIFACTS) {
      setPickerError(`One outcome can use at most ${MAX_ARTIFACTS} verified artifacts.`);
      return;
    }
    const bridge = desktopBridge();
    if (!bridge?.pickRunInput) {
      setPickerError('Open Implexa Desktop to add verified artifacts. Browser filenames are not accepted.');
      return;
    }
    const inputType = expectedType || artifactType;
    const field = pickerField(inputType);
    pickerInFlight.current = true;
    pendingInputKey.current = field.key;
    activeVerificationOperation.current = null;
    setPicking(true);
    setPickerError(null);
    setVerificationProgress(null);
    setCancelingVerification(false);
    setVerificationSurface(replan ? 'plan' : 'inputs');
    try {
      const raw = await bridge.pickRunInput({ inputKey: field.key, inputSessionId: inputSessionId.current, selection: 'file' }).catch(() => null);
      const result = resolvePickerResult(raw, field);
      if (result.kind === 'failed') setPickerError(result.message);
      if (result.kind === 'bound') {
        inputSessionId.current = result.inputSessionId;
        const next: VerifiedArtifact = {
          ...result.binding,
          inputSessionId: result.inputSessionId,
          inputType,
        };
        const duplicate = artifacts.some((artifact) => artifact.artifactId === next.artifactId && artifact.sha256 === next.sha256);
        const nextArtifacts = duplicate
          ? artifacts.map((artifact) => artifact.artifactId === next.artifactId && artifact.sha256 === next.sha256
            ? { ...artifact, inputType: next.inputType }
            : artifact)
          : [...artifacts, next];
        if (replan) {
          setArtifacts(nextArtifacts);
          // The verified input changes the canonical OutcomeIntent. A prepare
          // idempotency key is bound to one exact intent, so reusing the key
          // from the input-free recommendation is correctly refused by the
          // Backend as an integrity violation.
          prepareIdempotencyKey.current = undefined;
          await requestPlan(undefined, nextArtifacts);
        } else if (!duplicate) {
          editArtifacts(nextArtifacts);
        }
      }
    } finally {
      pickerInFlight.current = false;
      pendingInputKey.current = null;
      activeVerificationOperation.current = null;
      setPicking(false);
      setVerificationProgress(null);
      setCancelingVerification(false);
    }
  }

  async function cancelVerification() {
    const operationId = activeVerificationOperation.current;
    const bridge = desktopBridge();
    if (!operationId || !bridge?.cancelRunInputVerification || cancelingVerification) return;
    setCancelingVerification(true);
    const result = await bridge.cancelRunInputVerification(operationId).catch(() => null);
    if (!result?.ok) {
      setPickerError(result?.error || 'Implexa Desktop could not cancel this verification.');
      setCancelingVerification(false);
    }
  }

  async function requestPlan(clarificationTaskKey?: string, artifactOverride = artifacts) {
    if (prepareInFlight.current !== null) return;
    const instructionsForRequest = canonicalOutcomeText(runInstructions);
    const goalForRequest = canonicalOutcomeText(goal);
    if (goalForRequest.length > MAX_OUTCOME_GOAL) {
      setStartError(`Outcome must be at most ${MAX_OUTCOME_GOAL.toLocaleString()} characters.`);
      return;
    }
    if (instructionsForRequest.length > MAX_RUN_INSTRUCTIONS) {
      setStartError(`Run instructions must be at most ${MAX_RUN_INSTRUCTIONS.toLocaleString()} characters.`);
      return;
    }
    const mine = (reqId.current += 1);
    prepareInFlight.current = mine;
    const current = () => mine === reqId.current;
    setPlan({ phase: 'planning' });
    setStartError(null);
    prepareIdempotencyKey.current ||= crypto.randomUUID();
    try {
      const res = await fetch('/api/outcome-productions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare', goal: goalForRequest,
          ...(instructionsForRequest ? { run_instructions: instructionsForRequest } : {}),
          quality,
          idempotency_key: prepareIdempotencyKey.current,
          deadline_at: deadline || null,
          max_budget_credits: parsedCredits,
          consequential_action_ceiling: { max_provider_calls: 0, max_spend_minor: 0, currency: 'USD' },
          input_references: artifactOverride.map((artifact) => ({
            kind: 'artifact', id: artifact.artifactId, digest: artifact.sha256,
            description: artifact.displayName, input_type: artifact.inputType,
            input_session_id: artifact.inputSessionId,
          })),
          ...(clarificationTaskKey ? { clarification_task_key: clarificationTaskKey } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!current()) return;
      if (!res.ok && res.status >= 400 && res.status < 500) {
        setPlan({ phase: 'invalid', message: body && typeof body.error === 'string' ? body.error : 'That request was refused.' });
        return;
      }
      const outcome = res.ok ? parsePlanResponse(body) : null;
      if (outcome?.kind === 'plan' && (
        outcome.intent.goal !== goalForRequest
        || (outcome.intent.run_instructions || '') !== instructionsForRequest
      )) {
        setPlan({ phase: 'invalid', message: 'The prepared plan did not retain the exact run instructions. Plan again before starting.' });
        return;
      }
      if (outcome?.kind === 'plan') setPlannedRunInstructions(instructionsForRequest);
      setPlan(outcome ? { phase: 'plan', outcome } : { phase: 'unavailable', message: UNAVAILABLE_COPY });
    } catch {
      if (current()) setPlan({ phase: 'unavailable', message: UNAVAILABLE_COPY });
    } finally {
      if (prepareInFlight.current === mine) prepareInFlight.current = null;
    }
  }

  async function provideMissingInput(kind: string) {
    if (runInstructionsError) {
      setStartError(runInstructionsError);
      return;
    }
    if (!OUTCOME_INPUT_TYPES.includes(kind as OutcomeInputType)) {
      setPickerError(`This plan requires an unsupported input type: ${kind}.`);
      return;
    }
    await addArtifact(kind as OutcomeInputType, true);
  }

  async function applyRunInstructions() {
    if (runInstructionsError) {
      setStartError(runInstructionsError);
      return;
    }
    prepareIdempotencyKey.current = undefined;
    await requestPlan(undefined, artifacts);
  }

  function updateRunInstructions(value: string) {
    setRunInstructions(value);
    setStartError(null);
  }

  async function startProduction() {
    if (startInFlight.current || instructionsDirty || runInstructionsError
      || plan.phase !== 'plan' || plan.outcome.kind !== 'plan') return;
    startInFlight.current = true;
    const selected = plan.outcome;
    const mine = reqId.current;
    const current = () => mine === reqId.current;
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/outcome-productions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', productionId: selected.productionId, expected_plan_digest: selected.plan.digest }),
      });
      const body = await res.json().catch(() => null);
      const returnedProductionId = res.ok && body?.ok === true
        ? (typeof body.productionId === 'string' ? body.productionId : typeof body.production?.id === 'string' ? body.production.id : null)
        : null;
      const productionId = returnedProductionId === selected.productionId ? returnedProductionId : null;
      if (productionId) { router.push(`/runs/productions/${productionId}`); return; }
      if (!current()) return;
      if (res.status === 409 || (res.status === 422 && body?.reason === 'plan_digest_mismatch')) {
        setPlan({ phase: 'invalid', message: 'That plan is no longer current. Plan again to get a fresh one.' });
      } else if (res.status === 422 && body && typeof body.error === 'string') {
        setStartError(body.error);
      } else {
        setStartError(UNCONFIRMED_START_COPY);
      }
    } catch {
      if (current()) setStartError(UNCONFIRMED_START_COPY);
    } finally {
      startInFlight.current = false;
      setStarting(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-ink-50">State the outcome</h2>
      <p className="text-sm text-ink-400 mt-1.5">Describe the result you need. Implexa will ask at most one question, then show one recommended Backend plan before anything starts.</p>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="outcome-goal" className="block text-sm font-medium text-ink-200">What outcome do you need?</label>
          <textarea id="outcome-goal" value={goal} onChange={(event) => editGoal(event.target.value)} rows={3} maxLength={2000} placeholder="e.g. Use my approved video sections and editable project to produce a high-quality final master." className="mt-1.5 w-full rounded-lg bg-ink-900 border border-ink-700 px-4 py-3 text-[15px] text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-ink-500" />
        </div>

        <div>
          <span className="block text-sm font-medium text-ink-200">Verified inputs</span>
          <p className="text-xs text-ink-500 mt-0.5">Optional. Implexa Desktop verifies each artifact; only its identity, digest, description, and input type are sent.</p>
          {artifacts.length > 0 && <ul className="mt-2 space-y-2">{artifacts.map((artifact) => (
            <li key={`${artifact.artifactId}-${artifact.sha256}`} className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
              <span className="truncate max-w-xs">{artifact.displayName}</span>
              <span className="rounded bg-ink-900 border border-ink-700 px-2 py-1 text-xs">{artifact.inputType.replaceAll('_', ' ')}</span>
              {artifact.storageMode === 'local_range_capability' && (
                <span className="basis-full text-[11px] text-amber-300">Kept on its current drive — keep the drive connected and the file unchanged.</span>
              )}
              {artifact.storageMode === 'managed_copy' && (
                <span className="basis-full text-[11px] text-ink-500">Copied into Implexa-managed storage for this run.</span>
              )}
              <button type="button" aria-label={`Remove ${artifact.displayName}`} onClick={() => editArtifacts(artifacts.filter((item) => item.artifactId !== artifact.artifactId))} className="text-ink-500 hover:text-ink-200">×</button>
            </li>
          ))}</ul>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label="Type of verified artifact to add" value={artifactType} onChange={(event) => setArtifactType(event.target.value as OutcomeInputType)} className="rounded bg-ink-900 border border-ink-700 px-2 py-1.5 text-xs text-ink-300">
              {OUTCOME_INPUT_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
            </select>
            <button type="button" onClick={() => addArtifact()} disabled={picking || artifacts.length >= MAX_ARTIFACTS} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 disabled:opacity-50">{picking ? 'Verifying…' : 'Add verified artifact'}</button>
          </div>
          {verificationSurface === 'inputs' && verificationProgress && (
            <RunInputVerificationProgress progress={verificationProgress} canceling={cancelingVerification} onCancel={cancelVerification} />
          )}
          {!inDesktop && <p role="status" className="mt-2 text-xs text-amber-300">Open Implexa Desktop to add verified artifacts. Browser filenames cannot be used.</p>}
          {pickerError && <p role="status" className="mt-2 text-xs text-red-400">{pickerError}</p>}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ink-200">Quality</legend>
          <div className="mt-1.5 grid sm:grid-cols-3 gap-2">{OUTCOME_QUALITIES.map((option) => (
            <label key={option.value} className={`rounded-lg border px-3 py-2.5 cursor-pointer ${quality === option.value ? 'border-brand-500 bg-brand-500/5' : 'border-ink-700 hover:border-ink-500'}`}>
              <span className="flex items-center gap-2"><input type="radio" name="outcome-quality" value={option.value} checked={quality === option.value} onChange={() => editQuality(option.value)} /><span className="text-sm text-ink-100">{option.label}</span></span>
              <span className="block text-xs text-ink-500 mt-1">{option.hint}</span>
            </label>
          ))}</div>
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-4">
          <div><label htmlFor="outcome-deadline" className="block text-sm font-medium text-ink-200">Deadline <span className="text-ink-500 font-normal">(optional)</span></label><input id="outcome-deadline" type="datetime-local" value={deadline} onChange={(event) => editDeadline(event.target.value)} className="mt-1.5 w-full rounded-lg bg-ink-900 border border-ink-700 px-4 py-2.5 text-sm text-ink-50" /></div>
          <div><label htmlFor="outcome-budget" className="block text-sm font-medium text-ink-200">Credit limit</label><input id="outcome-budget" type="number" min={1} max={100000} step={1} value={budgetCredits} onChange={(event) => editBudget(event.target.value)} className="mt-1.5 w-full rounded-lg bg-ink-900 border border-ink-700 px-4 py-2.5 text-sm text-ink-50" /><p className="text-xs text-ink-500 mt-1">Provider calls and consequential dollar spend still default to zero.</p></div>
        </div>

        <button type="button" onClick={() => requestPlan()} disabled={!requestReady || plan.phase === 'planning'} className="rounded-lg bg-brand-500 text-ink-950 px-6 py-3 text-sm font-medium hover:bg-brand-400 transition-colors disabled:opacity-50">{plan.phase === 'planning' ? 'Planning…' : 'Plan this outcome'}</button>
        <p className="text-xs text-ink-500">Planning starts nothing. Credits are the planning unit; no client-side dollar conversion is performed.</p>
      </div>

      {plan.phase === 'invalid' && <p role="status" className="mt-4 text-sm text-red-400">{plan.message}</p>}
      {plan.phase === 'unavailable' && <div role="status" aria-label="Planning unavailable" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"><p className="text-sm text-amber-300">{plan.message}</p></div>}
      {plan.phase === 'plan' && plan.outcome.kind === 'clarification_required' && (
        <section aria-label="Outcome clarification" className="mt-5 card p-5">
          <h3 className="text-sm font-semibold text-ink-50">One question</h3>
          <p className="text-sm text-ink-300 mt-1">{plan.outcome.clarification.question}</p>
          <div className="mt-3 flex flex-wrap gap-2">{plan.outcome.clarification.choices.map((choice) => <button key={choice.taskKey} type="button" onClick={() => requestPlan(choice.taskKey)} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:border-ink-500">{choice.label}</button>)}</div>
        </section>
      )}
      {plan.phase === 'plan' && plan.outcome.kind !== 'clarification_required' && <div className="mt-5"><OutcomePlanCard outcome={plan.outcome} onStart={startProduction} onProvideInput={provideMissingInput} starting={starting} providingInput={picking} startError={startError} verificationProgress={verificationSurface === 'plan' ? verificationProgress : null} cancelingVerification={cancelingVerification} onCancelVerification={cancelVerification} runInstructions={runInstructions} onRunInstructionsChange={updateRunInstructions} instructionsDirty={instructionsDirty} instructionsError={runInstructionsError} onApplyRunInstructions={applyRunInstructions} /></div>}
    </div>
  );
}
