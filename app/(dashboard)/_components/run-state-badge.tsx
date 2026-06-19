/**
 * <RunStateBadge /> - the live state of a run (running / stalled / done /
 * failed), shown wherever a run appears (Home recent results, Results feed,
 * /runs). Pure presentational server component; the state + reason come from
 * lib/run-state.ts. A pulsing dot marks a live state (running / stalled) so a
 * stuck run draws the eye instead of reading as just another finished row.
 *
 * The "est." marker mirrors RemoteSafetyBadge: shown when the state is derived
 * locally rather than read from the authoritative backend run_state (migration
 * 0065). Once that column is populated, the marker drops on its own.
 */

import { presentationFor, type RunStateInfo } from '@/lib/run-state';

export function RunStateBadge({
  info,
  size = 'sm',
}: {
  info: RunStateInfo;
  size?: 'sm' | 'xs';
}) {
  const spec = presentationFor(info);
  const pad = size === 'xs' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const tip = info.estimated ? `${info.reason} (estimated - pending the backend run state)` : info.reason;
  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${pad} ${spec.classes}`}
    >
      {/* Active states (running / stalled / waiting-for-approval) render a clean
          spinner; terminal ones (done / failed / queued / partial) a static dot. */}
      {spec.pulse ? (
        <span className={`inline-block h-3 w-3 rounded-full border-2 ${spec.spinCls} animate-spin`} aria-hidden="true" />
      ) : (
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${spec.dot}`} aria-hidden="true" />
      )}
      {/* info.label, not spec.label: a `partial` run derives state='completed'
          but label='Partial' — using spec.label would mislabel it "Done"
          (a degraded run reading as success, the exact thing this surface
          exists to prevent). info.label === spec.label for every other state. */}
      {info.label}
      {info.estimated && <span className="opacity-60 font-normal">· est.</span>}
    </span>
  );
}
