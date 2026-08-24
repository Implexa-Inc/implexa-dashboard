'use client';

/**
 * Files in a worker's markdown are claims. These are different: each item came
 * from run_artifacts after the desktop resolved containment/symlinks and hashed
 * the file. Keep the distinction visible in the UI so a user never has to copy
 * a relative path from prose just to reach a delivered file.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export type VerifiedArtifact = {
  relativePath: string;
  validatedPath: string;
  role: string | null;
  sizeBytes: number | null;
};

type DesktopBridge = {
  openPath?: (path: string) => Promise<{ ok: boolean; error?: string }> | void;
  revealPath?: (path: string) => Promise<{ ok: boolean; error?: string }> | void;
  localInputReauthorizationState?: (runId: string) => Promise<{
    ok?: boolean;
    applicable?: boolean;
    required?: boolean;
    label?: string;
    error?: string;
  }>;
  reauthorizeRunInputs?: (runId: string) => Promise<{
    ok?: boolean;
    recovered?: number;
    canceled?: boolean;
    error?: string;
  }>;
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

export default function VerifiedArtifacts({ artifacts, runId }: { artifacts: VerifiedArtifact[]; runId?: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [refreshing, refresh] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [sourceReconnect, setSourceReconnect] = useState<{ required: boolean; label?: string } | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2200);
  };
  const bridge = () => (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop;

  useEffect(() => {
    const state = bridge()?.localInputReauthorizationState;
    if (!runId || typeof state !== 'function') return;
    let active = true;
    void state(runId).then((result) => {
      if (!active || !result?.ok || result.applicable === false) return;
      setSourceReconnect({ required: result.required === true, label: result.label });
    }).catch(() => { /* The files card remains useful when the native check is unavailable. */ });
    return () => { active = false; };
  }, [runId]);

  const reconnectSource = useCallback(async () => {
    const reconnect = bridge()?.reauthorizeRunInputs;
    if (!runId || typeof reconnect !== 'function') return;
    setReconnecting(true);
    setMessage('Select the original file. Implexa will verify every byte before restoring access.');
    try {
      const result = await reconnect(runId);
      if (result?.ok) {
        setSourceReconnect({ required: false });
        flash('Original source verified — queued work can continue');
        refresh(() => router.refresh());
      } else if (!result?.canceled) {
        flash(result?.error === 'input_digest_mismatch'
          ? 'That file does not match the original source'
          : 'Could not verify the original source');
      } else {
        setMessage(null);
      }
    } catch {
      flash('Could not verify the original source');
    } finally {
      setReconnecting(false);
    }
  }, [runId, router]);
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

  const finalCount = artifacts.filter((artifact) => artifact.role === 'final_output').length;
  return (
    <section className="mb-6 rounded-lg border border-emerald-500/35 bg-emerald-500/[0.06] p-4" aria-label="Files and artifacts">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-50">Files &amp; artifacts</h2>
          <p className="mt-1 text-xs text-ink-400">
            {artifacts.length
              ? `Checked on this Mac by Implexa · ${finalCount} final ${finalCount === 1 ? 'output' : 'outputs'} · ${artifacts.length} total`
              : 'No verified files yet. Refresh after this run creates or validates files.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refresh(() => router.refresh())}
            disabled={refreshing}
            className="rounded border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-60"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {artifacts.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-controls="run-artifact-list"
              className="rounded border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
            >
              {expanded ? 'Hide files' : `View files (${artifacts.length})`}
            </button>
          )}
        </div>
      </div>
      {sourceReconnect?.required && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-300">
            Implexa forgot the private source path after restarting. Reconnect {sourceReconnect.label || 'the original source'} to verify its exact bytes; the file stays on this Mac.
          </p>
          <button
            type="button"
            onClick={() => void reconnectSource()}
            disabled={reconnecting}
            className="rounded border border-amber-500/45 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/10 disabled:opacity-60 dark:text-amber-300"
          >
            {reconnecting ? 'Verifying source…' : 'Reconnect original source'}
          </button>
        </div>
      )}
      {expanded && artifacts.length > 0 && (
        <ul id="run-artifact-list" className="mt-3 max-h-[28rem] overflow-y-auto divide-y divide-emerald-500/15 rounded-md border border-emerald-500/20 bg-ink-950/30">
          {artifacts.map((artifact) => (
            <li key={artifact.validatedPath} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink-100" title={artifact.relativePath}>{artifact.relativePath.split('/').at(-1)}</div>
                <div className="mt-0.5 truncate text-xs text-ink-500" title={artifact.relativePath}>
                  {roleLabel(artifact.role)}{size(artifact.sizeBytes) ? ` · ${size(artifact.sizeBytes)}` : ''}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-ink-600" title={artifact.relativePath}>{artifact.relativePath}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button type="button" onClick={() => void open(artifact)} className="rounded border border-emerald-500/40 px-2.5 py-1 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300">Open</button>
                <button type="button" onClick={() => void reveal(artifact)} className="rounded border border-ink-700 px-2.5 py-1 text-ink-300 hover:bg-ink-800">Finder</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="mt-2 text-xs text-ink-300" role="status">{message}</p>}
    </section>
  );
}
