'use client';

/**
 * <QualityModeSelector /> — pick fast | professional | production.
 *
 * RULES THIS COMPONENT ENFORCES:
 *
 *  * The persisted/emitted value is the BACKEND mode value, never a display label.
 *  * What each mode actually does beyond its one fixed sentence is displayed from
 *    the backend-compiled proposal for that mode (differences prop) — nothing is
 *    computed here.
 *  * Production renders, but disabled, with the backend's machine-readable reason
 *    translated to honest copy. It is gated by BOTH the static build flag and the
 *    compiled availability (see isModeSelectable) — deleting one guard leaves the
 *    other.
 *  * Native radio inputs, so arrow keys / Tab / Space work without re-implementing
 *    a roving tabindex.
 */

import { useId } from 'react';
import {
  QUALITY_MODES, qualityModeSelectorState, unavailableModeCopy, qualityModeOption,
  modeDifferenceRows, type QualityMode,
} from '@/lib/quality-mode';

export type ModeCompilation = {
  availability: boolean;
  unavailableReason: string | null;
  requiredMissingCapabilities: string[];
  densityLabel: string | null;
  generationsPerMoment: number | null;
  stageKinds: string[];
  reviewRequirements: string[];
} | null;

type Props = {
  value: QualityMode;
  onChange: (mode: QualityMode) => void;
  /**
   * Backend compilation per mode, or null when that mode has not been compiled.
   * This is the ONLY source of mode-difference detail.
   */
  compiledByMode: Record<QualityMode, ModeCompilation>;
  disabled?: boolean;
};

export default function QualityModeSelector({ value, onChange, compiledByMode, disabled }: Props) {
  const groupId = useId();
  const selectorState = qualityModeSelectorState(compiledByMode);
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-sm font-medium text-ink-200">Quality</legend>
      <div role="presentation" className="mt-2 grid gap-2 sm:grid-cols-3">
        {QUALITY_MODES.map((mode) => {
          const option = qualityModeOption(mode);
          const compiled = compiledByMode[mode];
          const selectable = selectorState[mode].selectable;
          const selected = value === mode;
          const differences = modeDifferenceRows(compiled);
          // Production is unavailable in this build even before any compilation
          // is seen; other modes are marked unavailable only when their own
          // compilation says so.
          const compiledUnavailable = compiled !== null && compiled.availability !== true;
          const markedUnavailable = compiledUnavailable || mode === 'production';
          return (
            <label
              key={mode}
              className={`relative flex min-w-0 cursor-pointer flex-col rounded-lg border p-3 ${
                selected ? 'border-ink-300 bg-ink-800/60' : 'border-ink-800 bg-ink-900/40'
              } ${selectable ? 'hover:border-ink-500' : 'cursor-not-allowed opacity-60'}`}
            >
              <input
                type="radio"
                name={`quality-mode-${groupId}`}
                // The VALUE is the backend identity. The label is only text beside it.
                value={option.value}
                checked={selected}
                disabled={!selectable}
                onChange={() => selectable && onChange(mode)}
                className="sr-only"
              />
              <span className="flex items-center gap-2">
                <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full border ${selected ? 'border-ink-100 bg-ink-100' : 'border-ink-600'}`} />
                <span className="text-sm font-medium text-ink-100">{option.label}</span>
                {markedUnavailable && (
                  <span className="ml-auto rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300">
                    Not available yet
                  </span>
                )}
              </span>
              <span className="mt-1 text-xs text-ink-400">{option.description}</span>

              {/* An unavailable mode explains itself with the translated backend
                  reason. Its compiled differences (Professional keeps its graph
                  for preview) still render beneath — described, not promised. */}
              {markedUnavailable && (
                <span className="mt-2 text-[11px] leading-snug text-amber-300/90">
                  {unavailableModeCopy(
                    mode,
                    compiled?.unavailableReason ?? null,
                    compiled?.requiredMissingCapabilities ?? [],
                  )}
                </span>
              )}
              {differences.length > 0 ? (
                <dl className="mt-2 space-y-0.5">
                  {differences.map((row) => (
                    <div key={row.term} className="flex gap-1.5 text-[11px] text-ink-500">
                      <dt className="shrink-0 font-medium text-ink-400">{row.term}:</dt>
                      <dd className="min-w-0">{row.detail}</dd>
                    </div>
                  ))}
                </dl>
              ) : !markedUnavailable ? (
                // No compiled proposal for this mode yet: say so instead of
                // describing behavior nobody compiled.
                <span className="mt-2 text-[11px] text-ink-600">
                  Details appear once this mode is compiled for your request.
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
