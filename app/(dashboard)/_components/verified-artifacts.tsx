'use client';

/**
 * Files in a worker's markdown are claims. These are different: each item came
 * from run_artifacts after the desktop resolved containment/symlinks and hashed
 * the file. Keep the distinction visible in the UI so a user never has to copy
 * a relative path from prose just to reach a delivered file.
 */

import { useCallback, useState } from 'react';

export type VerifiedArtifact = {
  relativePath: string;
  validatedPath: string;
  role: string | null;
  sizeBytes: number | null;
};

type DesktopBridge = {
  openPath?: (path: string) => Promise<{ ok: boolean; error?: string }> | void;
  revealPath?: (path: string) => Promise<{ ok: boolean; error?: string }> | void;
};

function size(bytes: number | null): string | null {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function roleLabel(role: string | null): string {
  if (role === 'final_output') return 'Final output';
  if (role === 'qa_report') return 'QA evidence';
  if (role === 'receipt') return 'Receipt';
  if (role === 'source') return 'Source';
  return 'Verified file';
}

export default function VerifiedArtifacts({ artifacts }: { artifacts: VerifiedArtifact[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2200);
  };
  const bridge = () => (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop;
  const copyPath = async (artifact: VerifiedArtifact) => {
    try {
      await navigator.clipboard.writeText(artifact.validatedPath);
      flash('Full path copied — paste into Finder with ⌘⇧G');
    } catch {
      flash("Couldn't copy the path");
    }
  };

  const open = useCallback(async (artifact: VerifiedArtifact) => {
    const fn = bridge()?.openPath;
    if (typeof fn === 'function') {
      try {
        const result = await fn(artifact.validatedPath);
        if (!result || result.ok) { flash('Opening…'); return; }
      } catch { /* copy fallback below */ }
    }
    await copyPath(artifact);
  }, []);

  const reveal = useCallback(async (artifact: VerifiedArtifact) => {
    const fn = bridge()?.revealPath;
    if (typeof fn === 'function') {
      try {
        const result = await fn(artifact.validatedPath);
        if (!result || result.ok) { flash('Revealing in Finder…'); return; }
      } catch { /* copy fallback below */ }
    }
    await copyPath(artifact);
  }, []);

  if (!artifacts.length) return null;
  return (
    <section className="mt-5 rounded-lg border border-emerald-500/35 bg-emerald-500/[0.06] p-4" aria-label="Verified files">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-50">Verified files</h2>
          <p className="mt-1 text-xs text-ink-400">Checked on this Mac by Implexa. These are the same files available to Judge.</p>
        </div>
        <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-300">{artifacts.length} verified</span>
      </div>
      <ul className="mt-3 divide-y divide-emerald-500/15 rounded-md border border-emerald-500/20 bg-ink-950/30">
        {artifacts.map((artifact) => (
          <li key={artifact.validatedPath} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink-100" title={artifact.relativePath}>{artifact.relativePath.split('/').at(-1)}</div>
              <div className="mt-0.5 truncate text-xs text-ink-500" title={artifact.relativePath}>
                {roleLabel(artifact.role)}{size(artifact.sizeBytes) ? ` · ${size(artifact.sizeBytes)}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={() => void open(artifact)} className="rounded border border-emerald-500/40 px-2.5 py-1 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300">Open</button>
              <button type="button" onClick={() => void reveal(artifact)} className="rounded border border-ink-700 px-2.5 py-1 text-ink-300 hover:bg-ink-800">Finder</button>
            </div>
          </li>
        ))}
      </ul>
      {message && <p className="mt-2 text-xs text-ink-300" role="status">{message}</p>}
    </section>
  );
}
