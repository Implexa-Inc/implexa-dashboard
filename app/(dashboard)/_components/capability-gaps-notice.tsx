import type { CapabilityGap } from '@/lib/activation';

/**
 * CapabilityGapsNotice — the dashboard consumer for checklist.capabilityGaps
 * (2026-07-22). A capability the agent needs but has NO viable tool for (every
 * candidate marked unavailable, or a stated tool preference that contradicted
 * itself). requirements can't express this — a gap has no step reflecting a
 * working tool — so without this surface the user could see an agent that
 * looks ready while it has no way to produce part of its promised output.
 *
 * Honest, not blocking: a required gap explains WHY "ready to run" is withheld;
 * a recommended gap is informational. Matches the backend soft-gate — activation
 * is never hard-stopped here, only the readiness claim is made truthful.
 */
export default function CapabilityGapsNotice({ gaps }: { gaps?: CapabilityGap[] }) {
  const list = Array.isArray(gaps) ? gaps : [];
  if (!list.length) return null;

  const required = list.filter((g) => g.requiredness === 'required_to_deliver');
  const recommended = list.filter((g) => g.requiredness !== 'required_to_deliver');

  return (
    <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
      <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
        {required.length
          ? 'This agent needs a tool it doesn’t have yet'
          : 'Optional capability without a tool'}
      </p>
      {required.length > 0 && (
        <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400 leading-snug">
          It can’t produce part of its result until you pick a tool for{' '}
          {required.map((g) => g.capabilityLabel).join(', ')}. It won’t show as ready to run until then.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {[...required, ...recommended].map((g) => (
          <li key={`${g.capability}-${g.requiredness}`} className="text-xs leading-snug">
            <span className="font-medium text-ink-100">{g.capabilityLabel}</span>
            {g.requiredness === 'required_to_deliver' ? (
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">required</span>
            ) : (
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-500">optional</span>
            )}
            {g.reason && <span className="block text-ink-500">{g.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
