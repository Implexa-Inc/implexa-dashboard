/**
 * <RemoteSafetyBadge /> - the remote-safe / local-only / unverified verdict,
 * shown wherever a workflow or routine appears (/workflows list + detail,
 * /scheduled rows, /overview needs-attention).
 *
 * Pure presentational server component (no client JS). The verdict + reason are
 * computed by lib/remote-safety.ts. The native title attribute carries the
 * one-line reason on hover; an "est." marker is shown when the verdict is a
 * heuristic rather than the authoritative backend watchdog verdict.
 */

import { VERDICT_PRESENTATION, type RemoteSafety } from '@/lib/remote-safety';

export function RemoteSafetyBadge({
  safety,
  size = 'sm',
}: {
  safety: RemoteSafety;
  size?: 'sm' | 'xs';
}) {
  const spec = VERDICT_PRESENTATION[safety.verdict];
  const pad = size === 'xs' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const tip = safety.estimated
    ? `${safety.reason} (estimated - pending the backend watchdog verdict)`
    : safety.reason;
  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${pad} ${spec.classes}`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${spec.dot}`}
        aria-hidden="true"
      />
      {spec.label}
      {safety.estimated && (
        <span className="opacity-60 font-normal">· est.</span>
      )}
    </span>
  );
}
