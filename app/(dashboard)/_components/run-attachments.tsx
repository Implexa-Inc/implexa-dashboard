'use client';

/**
 * Shared per-run attachment plumbing (extracted from <AgentActions />, task_4efaa026).
 *
 * The per-run note + attached file PATHS ride a run-request (the `note` field) — a
 * one-off channel, never the saved standing note. The drainer reads them back from
 * the request's `intent` and hands them to the run. This module is the reusable
 * core so BOTH the run-setup pop-up (<AgentActions />) and the universal
 * "Continue this run" box (<RunContinueBox />) attach files the same way.
 */

import { useEffect, useState } from 'react';

export const MAX_RUN_FILES = 8;

// Label for the per-run attachment line baked into the note. The hands-off run is
// told to Read these paths as context/feedback.
export const ATTACH_MARKER = '📎 Attached for this run';
// Same plumbing, but for a hands-off BUILD: the Home "Build an agent" box bakes the
// attached paths into the build `intent` so the drainer's generate_workflow sees them.
export const ATTACH_BUILD_MARKER = '📎 Attached for this build';

/**
 * Combine the user's prose with any attached file PATHS into one text blob.
 * `marker` lets callers tailor the label (per-run note vs per-build intent); it
 * defaults to the per-run marker so existing callers are unchanged.
 */
export function composeNoteWithFiles(note: string, files: string[], marker: string = ATTACH_MARKER): string {
  const base = note.trim();
  if (!files.length) return base;
  const line = `${marker} (read these files as context/feedback): ${files.join(', ')}`;
  return base ? `${base}\n\n${line}` : line;
}

// The desktop bridge (window.implexaDesktop). pickFile opens the native OS picker
// and returns a real absolute path Claude can Read — the same bridge the kind="file"
// config question uses. It only exists inside the Implexa desktop app, so the attach
// affordance is gated on it (a plain browser can't hand Claude a local path).
export type DesktopBridge = {
  openAgent?: () => Promise<{ ok: boolean }>;
  handoffAgent?: (prompt: string, surface?: string, target?: string) => Promise<{ ok: boolean; mode?: string }>;
  pickFile?: (opts?: unknown) => Promise<{ ok: boolean; path?: string }>;
  /** Trusted typed-input boundary. Desktop hashes/registers the local file and
   * retains its path locally; web/backend receive identity + media metadata only. */
  pickRunInput?: (opts: {
    inputKey: string;
    inputSessionId?: string;
    accept?: { mediaTypes?: string[]; extensions?: string[] };
  }) => Promise<{
    ok: boolean;
    /** Set when the user dismissed the native picker: keep state, show nothing. */
    canceled?: boolean;
    /** Set on every genuine failure, so a refusal can be explained rather than swallowed. */
    error?: string;
    inputSessionId?: string;
    artifactId?: string;
    sha256?: string;
    displayName?: string;
    mediaType?: string;
  }>;
  /** Verify and bind the file this agent's SETUP already holds for `inputKey`,
   * so a saved source is not re-picked before every run. No path crosses from
   * this page: Desktop asks the server what the user saved and binds only that,
   * hashing it afresh so the run gets the bytes that exist now. */
  bindSavedRunInput?: (opts: {
    slug: string;
    source?: string;
    inputKey: string;
    inputSessionId?: string;
    accept?: { mediaTypes?: string[]; extensions?: string[] };
  }) => Promise<{
    ok: boolean;
    error?: string;
    inputSessionId?: string;
    artifactId?: string;
    sha256?: string;
    displayName?: string;
    mediaType?: string;
  }>;
};
export function desktopBridge(): DesktopBridge | undefined {
  return typeof window !== 'undefined'
    ? (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop
    : undefined;
}
export function fileName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** State + handlers for attaching per-run files via the native picker. */
export function useRunAttachments() {
  const [files, setFiles] = useState<string[]>([]);
  // Whether the native file picker bridge is present (desktop app only) — gates the
  // attach affordance, since a plain browser can't give Claude a local path.
  const [canAttach, setCanAttach] = useState(false);
  useEffect(() => { setCanAttach(!!desktopBridge()?.pickFile); }, []);

  async function attachFile() {
    const bridge = desktopBridge();
    if (!bridge?.pickFile) return;
    const r = await bridge.pickFile().catch(() => null);
    if (r?.ok && r.path) {
      setFiles((prev) => (prev.includes(r.path!) ? prev : [...prev, r.path!].slice(0, MAX_RUN_FILES)));
    }
  }
  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }
  function reset() { setFiles([]); }

  return { files, setFiles, canAttach, attachFile, removeFile, reset };
}

/** The attach button + attached-file chips. Desktop-only (disabled with a hint in a
 *  plain browser, which can't hand Claude a local path). */
export function AttachFiles({
  files, canAttach, onAttach, onRemove, hint = 'A screenshot, PDF, doc — the run reads it as context.',
}: {
  files: string[];
  canAttach: boolean;
  onAttach: () => void;
  onRemove: (i: number) => void;
  hint?: string;
}) {
  return (
    <>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onAttach}
          disabled={!canAttach || files.length >= MAX_RUN_FILES}
          title={canAttach ? 'Attach a screenshot or file for this run' : 'Attach files in the Implexa desktop app'}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 text-ink-300 px-2.5 py-1.5 text-xs hover:border-ink-500 hover:text-ink-100 transition-colors disabled:opacity-40 disabled:hover:border-ink-700 disabled:hover:text-ink-300"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.2 9.19a1 1 0 01-1.41-1.41l8.49-8.49" />
          </svg>
          Attach file
        </button>
        {canAttach && <span className="text-[11px] text-ink-500">{hint}</span>}
      </div>

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((p, i) => (
            <span
              key={p}
              title={p}
              className="inline-flex items-center gap-1.5 max-w-[220px] rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-200"
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9l-7-7z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 2v7h7" />
              </svg>
              <span className="truncate">{fileName(p)}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${fileName(p)}`}
                className="text-ink-500 hover:text-rose-400 leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
