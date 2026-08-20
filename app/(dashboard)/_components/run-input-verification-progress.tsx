'use client';

import type { RunInputProgress } from './run-attachments';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export default function RunInputVerificationProgress({ progress, canceling, onCancel }: {
  progress: RunInputProgress;
  canceling: boolean;
  onCancel: () => void;
}) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(progress.percent) ? progress.percent : 0));
  const label = progress.inputKey.replaceAll('_', ' ');
  return (
    <div role="status" aria-label="Local input verification" className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-sky-200">Reading locally to verify — not uploading</p>
          <p className="mt-1 text-xs text-ink-400">
            {label} · {formatBytes(progress.bytesRead)} of {formatBytes(progress.totalBytes)} · {Math.round(percent)}%
          </p>
          <div
            role="progressbar"
            aria-label={`Verifying ${label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800"
          >
            <div className="h-full rounded-full bg-sky-400 transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={canceling}
          className="rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-500 disabled:opacity-50"
        >
          {canceling ? 'Canceling…' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
