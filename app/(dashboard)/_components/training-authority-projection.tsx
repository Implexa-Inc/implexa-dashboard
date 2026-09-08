'use client';

/**
 * <TrainingAuthorityProjection /> — the read-only training record (F0 item 8).
 *
 * Shows the source, the selected evidence, the decisions, and the current authority
 * state. READ ONLY: nothing on this surface writes, and nothing on it activates.
 *
 * ── THE SIX ROWS ─────────────────────────────────────────────────────────────────
 *
 * §1.3 forbids collapsing requested, demonstrated, implemented, verified, accepted and
 * activated into one status, so this renders six rows with six labels and six
 * sentences — never a single badge, never a progress bar, and never a tick that stands
 * for more than the one fact beside it. `lib/training-review-lifecycle.ts` holds the
 * words; the render tests assert they come out DISTINCT on screen, because six keys in
 * an object and one sentence on a screen is still a collapse.
 *
 * An UNREAD fact is styled differently from a `no` fact for the same reason: "Implexa
 * could not read this" rendered in the grey of "this did not happen" is the collapse
 * arriving through CSS after the types stopped it.
 */

import {
  LIFECYCLE_FACT_KEYS, activationStance, factLabel, factSentence, factTone,
  type AuthorityState,
} from '@/lib/training-review-lifecycle';
import {
  formatBytes, formatDuration, type TrainingProjectionStatus,
} from '@/lib/training-review-projection';
import {
  ACTIVE_LEARNING_BODY, ACTIVE_LEARNING_HEADING,
  INERT_CANDIDATE_BODY, INERT_CANDIDATE_HEADING,
  NO_RECORDING_UPLOAD_NOTICE, PROJECTION_UNAVAILABLE, STATE_UNKNOWN_COPY,
} from '@/lib/training-review-copy';

const TONE_CLASS = {
  affirmed: 'text-emerald-300',
  'not-yet': 'text-ink-400',
  unread: 'text-amber-300',
} as const;

const TONE_MARK = { affirmed: '✓', 'not-yet': '·', unread: '?' } as const;

function LifecycleRows({ state }: { state: AuthorityState }) {
  return (
    <ul className="space-y-1.5" aria-label="Current authority state">
      {LIFECYCLE_FACT_KEYS.map((key) => {
        const fact = state[key];
        const tone = factTone(fact);
        return (
          <li key={key} className="flex gap-2 text-[13px]" data-fact={key} data-fact-status={fact.status}>
            <span className={`w-3 shrink-0 ${TONE_CLASS[tone]}`} aria-hidden="true">{TONE_MARK[tone]}</span>
            <span className="min-w-0">
              <span className={`font-medium ${TONE_CLASS[tone]}`}>{factLabel(key)}</span>
              <span className="text-ink-400"> — {factSentence(fact)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Inert candidate versus active learning.
 *
 * Two different components' worth of meaning, so they get two headings, two bodies and
 * two `data-stance` values. §1.3 and the F0 must-nots both turn on the customer being
 * able to tell, at a glance, whether anything about their next run changed. In F0 the
 * answer is always no — and saying so plainly is more honest than omitting the panel.
 */
function ActivationPanel({ state }: { state: AuthorityState }) {
  const stance = activationStance(state);
  if (stance === 'unknown') {
    return (
      <div
        className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2.5"
        data-stance="unknown" role="status"
      >
        <p className="text-[13px] font-medium text-amber-200">Implexa could not read the activation state</p>
        <p className="mt-1 text-[13px] text-ink-400">{STATE_UNKNOWN_COPY}</p>
      </div>
    );
  }
  const active = stance === 'active_learning';
  return (
    <div
      className={`rounded-md border px-3 py-2.5 ${
        active ? 'border-emerald-900/60 bg-emerald-950/20' : 'border-ink-800 bg-ink-950/50'
      }`}
      data-stance={stance}
    >
      <p className={`text-[13px] font-medium ${active ? 'text-emerald-200' : 'text-ink-200'}`}>
        {active ? ACTIVE_LEARNING_HEADING : INERT_CANDIDATE_HEADING}
      </p>
      <p className="mt-1 text-[13px] text-ink-400">{active ? ACTIVE_LEARNING_BODY : INERT_CANDIDATE_BODY}</p>
    </div>
  );
}

export default function TrainingAuthorityProjection({ status }: { status: TrainingProjectionStatus }) {
  // UNAVAILABLE IS NOT EMPTY (`lib/review.ts`'s rule, and `verified-artifacts.tsx`'s
  // register). A failed read says so; it never renders a calm empty record.
  if (!status.live) {
    return (
      <section className="rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2.5" role="status"
        aria-label="Training record">
        <p className="text-[13px] text-ink-200">{PROJECTION_UNAVAILABLE}</p>
        <p className="mt-1 text-[12px] text-ink-500">Reason: {status.reason}</p>
      </section>
    );
  }

  const { source, evidence, decisions, authorityState, submission, contractSkew } = status.projection;
  const kept = evidence.filter((entry) => !entry.revoked);

  return (
    <section className="space-y-3" aria-label="Training record">
      {contractSkew && (
        <p className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[12px] text-amber-200"
          role="status">
          This record was written against {contractSkew}, which Implexa does not fully read yet. Some of it may be missing.
        </p>
      )}

      <div className="rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2.5">
        <h3 className="text-[13px] font-medium text-ink-200">What you supplied</h3>
        {source ? (
          <dl className="mt-1.5 space-y-1 text-[13px] text-ink-400">
            <div><dt className="inline text-ink-500">Kind: </dt><dd className="inline">
              {source.sourceKind === 'owner_demonstration' ? 'Work you demonstrated' : 'Earlier agent work'}
            </dd></div>
            {source.mediaType && (
              <div><dt className="inline text-ink-500">Format: </dt><dd className="inline">{source.mediaType}</dd></div>
            )}
            {formatDuration(source.durationMs) && (
              <div><dt className="inline text-ink-500">Length: </dt>
                <dd className="inline">{formatDuration(source.durationMs)}</dd></div>
            )}
            {formatBytes(source.sizeBytes) && (
              <div><dt className="inline text-ink-500">Size: </dt>
                <dd className="inline">{formatBytes(source.sizeBytes)}</dd></div>
            )}
            {source.machineLabel && (
              <div><dt className="inline text-ink-500">On: </dt><dd className="inline">{source.machineLabel}</dd></div>
            )}
            {/* The recording's identity is its digest. No path is carried, stored or
                rendered anywhere on this surface (§4.2, §6.1). */}
            <div><dt className="inline text-ink-500">Recording digest: </dt>
              <dd className="inline font-mono text-[11px]">{source.mediaSha256.slice(0, 16)}…</dd></div>
            <div><dt className="inline text-ink-500">Custody: </dt><dd className="inline">
              {source.custody === 'local_only'
                ? NO_RECORDING_UPLOAD_NOTICE
                : 'Selected moments have been saved to your private Agent history.'}
            </dd></div>
          </dl>
        ) : (
          <p className="mt-1.5 text-[13px] text-ink-400">{STATE_UNKNOWN_COPY}</p>
        )}
      </div>

      <div className="rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2.5">
        <h3 className="text-[13px] font-medium text-ink-200">Moments you kept</h3>
        {kept.length ? (
          <ul className="mt-1.5 space-y-1 text-[13px] text-ink-400">
            {kept.map((entry) => (
              <li key={entry.id} data-evidence-kind={entry.kind}>
                {entry.kind === 'clip' ? 'Clip' : entry.kind === 'frame' ? 'Frame' : 'Transcript'}
                {entry.temporalRange
                  ? ` · ${Math.round(entry.temporalRange.startMs / 1000)}s`
                    + (entry.temporalRange.endMs === null ? '' : `–${Math.round(entry.temporalRange.endMs / 1000)}s`)
                  : ''}
                {entry.custody === 'local_only' ? ' · still on this Mac' : ' · in your private Agent history'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[13px] text-ink-400">No moments have been kept from this recording yet.</p>
        )}
      </div>

      <div className="rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2.5">
        <h3 className="text-[13px] font-medium text-ink-200">Decisions</h3>
        <p className="mt-1.5 text-[13px] text-ink-400">
          {decisions.length
            ? `${decisions.length} proposed from this recording.`
            : 'No decisions have been proposed from this recording yet.'}
        </p>
        {submission && (
          <p className="mt-1 text-[12px] text-ink-500">
            Frozen submission {submission.digest.slice(0, 12)}…
            {submission.annotationCount === null ? '' : ` · ${submission.annotationCount} moments`}
          </p>
        )}
      </div>

      <div className="rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2.5">
        <h3 className="mb-2 text-[13px] font-medium text-ink-200">Where this stands</h3>
        <LifecycleRows state={authorityState} />
      </div>

      <ActivationPanel state={authorityState} />
    </section>
  );
}
