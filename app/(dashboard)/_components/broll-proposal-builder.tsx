'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import QualityModeSelector from './quality-mode-selector';
import ProfessionalBrollBuilder from './professional-broll-builder';
import type { TimelineMoment } from '@/lib/professional-v2-timeline';
import type { QualityMode } from '@/lib/quality-mode';
import { formatDurationMs, durationSeconds, withinSourceDuration, type VerifiedGenerationSource } from '@/lib/generation-source';
import {
  beginProposalCreate, parseGenerationCreateResponse, parseGenerationPreviewSet,
  proposalCreateLabel, proposalEntryError, proposalSummaryLine, validateGenerationMoment,
  type GenerationMomentInput, type GenerationPreviewSet,
} from '@/lib/generation-proposal-entry';

type Props = {
  runId: string;
  agentSubject: string;
  agentName: string;
  /**
   * The EXACT validated source both lanes are cut into, with the authoritative
   * Desktop-probed length. Quick is bound exactly like Professional: an unbound
   * Quick moment would just be the cheaper way to buy a clip with nowhere to go.
   */
  source: VerifiedGenerationSource;
  /** Moments of a Professional plan being edited, loaded server-side. */
  seedMoments?: TimelineMoment[] | null;
};

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

/**
 * The two entry lanes.
 *
 * `quick` is the original single-moment flow, byte-for-byte unchanged: it still
 * compares Quick / Professional / Production through the v1 contract, and every
 * proposal it creates carries no control-contract discriminator at all.
 *
 * `professional` is the multi-moment `professional-generation-control.v2` lane.
 * It is a SEPARATE lane rather than a fourth mode inside the comparison because
 * it edits a fundamentally different object — a timeline, not one window — and
 * folding it into the selector would have made the Quick flow's state machine
 * carry a plan shape it never had.
 */
type EntryLane = 'quick' | 'professional';

export default function BrollProposalBuilder({ runId, agentSubject, agentName, source, seedMoments = null }: Props) {
  const router = useRouter();
  const createFlight = useRef(false);
  // Quick stays the default. A seeded timeline means the user arrived by editing
  // a Professional plan, and landing them on the Quick lane would hide the very
  // moments they came to change.
  const [lane, setLane] = useState<EntryLane>(seedMoments && seedMoments.length ? 'professional' : 'quick');
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
    // THE SOURCE-DURATION CEILING, in the same integer milliseconds the backend
    // compares: `end <= duration` is valid and one millisecond beyond is not,
    // and two floats differing in the last bit must not decide which side of
    // that the user is on.
    if (!withinSourceDuration(
      Math.round(moment.startSeconds * 1000), Math.round(moment.endSeconds * 1000), source.mediaDurationMs,
    )) {
      setError(`This moment runs past the end of the source video (${formatDurationMs(source.mediaDurationMs)}). A clip generated for it would have nowhere to go.`);
      return;
    }
    setPhase('previewing'); setError(null); setPreviews(null);
    const modes: QualityMode[] = ['fast', 'professional', 'production'];
    const responses = await Promise.all(modes.map(async (qualityMode) => {
      const result = await action({
        action: 'preview', agentSubject, sourceRunId: runId, qualityMode,
        // NAMED. With more than one validated final video the backend refuses to
        // choose, because the two files may not be the same length.
        sourceArtifactId: source.artifactId,
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
      sourceArtifactId: source.artifactId,
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
          {lane === 'quick'
            ? `Add one precise visual moment to ${agentName}'s result. Comparing plans is free; generation starts only after a separate approval.`
            : `Lay out a full B-roll timeline for ${agentName}'s result. Compiling a plan is free; generation starts only after a separate approval.`}
        </p>
      </div>

      <p className="mt-3 text-xs text-ink-400">
        Cutting into <span className="font-medium text-ink-200">{source.relativePath}</span>
        {' · source length '}
        <span className="font-medium text-ink-200">{formatDurationMs(source.mediaDurationMs)}</span>
      </p>

      <div role="group" aria-label="Generation lane" className="mt-4 flex flex-wrap gap-2">
        {([
          ['quick', 'Quick', 'One moment, one take.'],
          ['professional', 'Professional', 'A timeline of moments, with variants, a Judge and a repair reserve.'],
        ] as const).map(([value, label, hint]) => (
          <button
            key={value} type="button" onClick={() => setLane(value)}
            aria-pressed={lane === value}
            className={`rounded-lg border px-3 py-2 text-left text-sm ${
              lane === value
                ? 'border-ink-500 bg-ink-900 text-ink-100'
                : 'border-ink-800 text-ink-400 hover:text-ink-200'
            }`}
          >
            <span className="block font-medium">{label}</span>
            <span className="mt-0.5 block text-[11px] text-ink-500">{hint}</span>
          </button>
        ))}
      </div>

      {lane === 'professional' && (
        <div className="mt-5">
          <ProfessionalBrollBuilder
            runId={runId} agentSubject={agentSubject} source={source} seedMoments={seedMoments}
          />
        </div>
      )}

      {lane === 'quick' && (
        <>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-ink-300">
            Start (seconds)
            {/* step="any", NOT a millisecond step: arrow keys move by one SECOND
                (verified in-browser), while typed sub-second values stay valid.
                step="0.001" made every arrow press a 1ms nudge — 5 became 4.999 —
                and step="1" would mark a typed 4.994 stepMismatch-invalid. */}
            <input value={start} onChange={(e) => edit(setStart, e.target.value)} inputMode="decimal" type="number"
              min="0" max={durationSeconds(source.mediaDurationMs)} step="any"
              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-ink-100" />
          </label>
          <label className="text-sm text-ink-300">
            End (seconds)
            <input value={end} onChange={(e) => edit(setEnd, e.target.value)} inputMode="decimal" type="number"
              min="0" max={durationSeconds(source.mediaDurationMs)} step="any"
              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-ink-100" />
          </label>
        </div>
        <label className="mt-4 block text-sm text-ink-300">
          What should the B-roll show?
          <textarea value={prompt} onChange={(e) => edit(setPrompt, e.target.value)} maxLength={700} rows={4}
            placeholder="Example: A clean aerial route map moving from Palo Alto to Pleasanton at sunrise, no text or logos."
            className="mt-1 w-full resize-y rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-ink-100 placeholder:text-ink-600" />
          <span className="mt-1 block text-xs text-ink-600">
            {prompt.length}/700 · the window must be 2–10 seconds, and must end at or before {formatDurationMs(source.mediaDurationMs)}
          </span>
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
        </>
      )}
    </section>
  );
}
