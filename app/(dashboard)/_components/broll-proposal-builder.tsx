'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import QualityModeSelector from './quality-mode-selector';
import type { QualityMode } from '@/lib/quality-mode';
import {
  beginProposalCreate, parseGenerationCreateResponse, parseGenerationPreviewSet,
  proposalCreateLabel, proposalEntryError, proposalSummaryLine, validateGenerationMoment,
  type GenerationMomentInput, type GenerationPreviewSet,
} from '@/lib/generation-proposal-entry';

type Props = { runId: string; agentSubject: string; agentName: string };

async function action(body: Record<string, unknown>): Promise<{ ok: boolean; status: number | null; body: unknown }> {
  try {
    const res = await fetch('/api/generation-proposals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: null, body: { unavailable: true } };
  }
}

export default function BrollProposalBuilder({ runId, agentSubject, agentName }: Props) {
  const router = useRouter();
  const createFlight = useRef(false);
  const [prompt, setPrompt] = useState('');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('5');
  const [mode, setMode] = useState<QualityMode>('fast');
  const [previews, setPreviews] = useState<GenerationPreviewSet | null>(null);
  const [phase, setPhase] = useState<'idle' | 'previewing' | 'ready' | 'creating'>('idle');
  const [error, setError] = useState<string | null>(null);

  const moment = useMemo<GenerationMomentInput>(() => ({
    id: 'moment-1', prompt, startSeconds: Number(start), endSeconds: Number(end),
  }), [prompt, start, end]);

  function edit(setter: (value: string) => void, value: string) {
    setter(value);
    // A plan is bound to exact prompt and timestamps. Editing destroys it rather
    // than leaving a stale cost/approval identity on screen.
    setPreviews(null); setPhase('idle'); setError(null); setMode('fast');
  }

  async function compare() {
    const invalid = validateGenerationMoment(moment);
    if (invalid) { setError(invalid); return; }
    setPhase('previewing'); setError(null); setPreviews(null);
    const modes: QualityMode[] = ['fast', 'professional', 'production'];
    const responses = await Promise.all(modes.map(async (qualityMode) => {
      const result = await action({
        action: 'preview', agentSubject, sourceRunId: runId, qualityMode,
        moments: [moment],
      });
      return [qualityMode, result] as const;
    }));
    const failed = responses.find(([, result]) => !result.ok);
    if (failed) {
      setPhase('idle'); setError(proposalEntryError(failed[1].ok, failed[1].body, 'preview', failed[1].status)); return;
    }
    const bodies = Object.fromEntries(responses.map(([m, result]) => [m, result.body])) as Record<QualityMode, unknown>;
    const parsed = parseGenerationPreviewSet(bodies, { agentSubject, sourceRunId: runId, moment });
    if (!parsed) {
      setPhase('idle');
      setError('The quality comparison was incomplete or inconsistent, so Implexa refused to show it.');
      return;
    }
    setPreviews(parsed); setMode('fast'); setPhase('ready');
  }

  async function createProposal() {
    if (!beginProposalCreate(createFlight, phase, !!previews, previews?.[mode].availability === true)) return;
    setPhase('creating'); setError(null);
    const result = await action({
      action: 'create', agentSubject, sourceRunId: runId, qualityMode: mode,
      moments: [moment],
    });
    if (!result.ok) {
      createFlight.current = false;
      setPhase('ready'); setError(proposalEntryError(result.ok, result.body, 'create', result.status)); return;
    }
    const created = parseGenerationCreateResponse(result.body, {
      agentSubject, sourceRunId: runId, qualityMode: mode, moment,
    });
    if (!created) {
      createFlight.current = false;
      setPhase('ready');
      setError('The proposal was created with an unexpected identity or plan, so Implexa refused to open it. Reload this run before trying again.');
      return;
    }
    router.push(`/generations/${encodeURIComponent(created.proposalId)}`);
  }

  const selected = previews?.[mode] ?? null;

  return (
    <section className="rounded-xl border border-ink-800 bg-ink-950/50 p-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Generate B-roll</h1>
        <p className="mt-1 text-sm text-ink-400">
          Add one precise visual moment to {agentName}&apos;s result. Comparing plans is free; generation starts only after a separate approval.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-ink-300">
          Start (seconds)
          {/* step="any", NOT a millisecond step: arrow keys move by one SECOND
              (verified in-browser), while typed sub-second values stay valid.
              step="0.001" made every arrow press a 1ms nudge — 5 became 4.999 —
              and step="1" would mark a typed 4.994 stepMismatch-invalid. */}
          <input value={start} onChange={(e) => edit(setStart, e.target.value)} inputMode="decimal" type="number" min="0" step="any"
            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-ink-100" />
        </label>
        <label className="text-sm text-ink-300">
          End (seconds)
          <input value={end} onChange={(e) => edit(setEnd, e.target.value)} inputMode="decimal" type="number" min="0" step="any"
            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-ink-100" />
        </label>
      </div>
      <label className="mt-4 block text-sm text-ink-300">
        What should the B-roll show?
        <textarea value={prompt} onChange={(e) => edit(setPrompt, e.target.value)} maxLength={700} rows={4}
          placeholder="Example: A clean aerial route map moving from Palo Alto to Pleasanton at sunrise, no text or logos."
          className="mt-1 w-full resize-y rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-ink-100 placeholder:text-ink-600" />
        <span className="mt-1 block text-xs text-ink-600">{prompt.length}/700 · the window must be 2–10 seconds</span>
      </label>

      {previews && (
        <div className="mt-5">
          <QualityModeSelector value={mode} onChange={setMode} compiledByMode={previews} disabled={phase === 'creating'} />
        </div>
      )}

      {selected && (
        <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900/50 p-4 text-sm">
          <p className="font-medium text-ink-100">{proposalSummaryLine(selected)}</p>
          <p className="mt-1 text-xs text-ink-400">
            {selected.provider && selected.model ? `${selected.provider} · ${selected.model} · ` : ''}
            {moment.startSeconds}s–{moment.endSeconds}s
          </p>
          <p className="mt-2 text-xs text-ink-500">
            Creating this proposal does not generate or spend. The next screen shows the exact tasks and asks for approval.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{error}</p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        {!previews ? (
          <button type="button" onClick={compare} disabled={phase === 'previewing'} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {phase === 'previewing' ? 'Comparing…' : 'Compare quality modes'}
          </button>
        ) : (
          <button type="button" onClick={createProposal}
            disabled={phase === 'creating' || selected?.availability !== true}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {phase === 'creating' ? 'Creating proposal…' : proposalCreateLabel(mode)}
          </button>
        )}
        <button type="button" onClick={() => router.back()} className="btn-outline px-4 py-2 text-sm">Cancel</button>
      </div>
    </section>
  );
}
