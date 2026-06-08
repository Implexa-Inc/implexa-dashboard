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

import { RUN_STATE_PRESENTATION, type RunStateInfo } from '@/lib/run-state';

export function RunStateBadge({
  info,
  size = 'sm',
}: {
  info: RunStateInfo;
  size?: 'sm' | 'xs';
}) {
  const spec = RUN_STATE_PRESENTATION[info.state];
  const pad = size === 'xs' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const tip = info.estimated ? `${info.reason} (estimated - pending the backend run state)` : info.reason;
  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${pad} ${spec.classes}`}
    >
      <span className={`relative inline-flex w-1.5 h-1.5`} aria-hidden="true">
        {spec.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping ${spec.dot}`} />
        )}
        <span className={`relative inline-flex w-1.5 h-1.5 rounded-full ${spec.dot}`} />
      </span>
      {spec.label}
      {info.estimated && <span className="opacity-60 font-normal">· est.</span>}
    </span>
  );
}
