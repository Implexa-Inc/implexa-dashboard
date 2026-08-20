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
import type { LocalInputStorageMode } from '@/lib/workflow-input-contract';

export const MAX_RUN_FILES = 8;

/** Progress emitted while Desktop reads a local typed input to establish its
 * content identity. No file bytes cross this bridge. */
export type RunInputProgress = {
  operationId: string;
  inputKey: string;
  phase: 'hashing';
  bytesRead: number;
  totalBytes: number;
  percent: number;
};

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
  /** Generic run/build/continue attachment. The explicitly selected absolute
   * path rides the same one-off request-note channel as ordinary attached files
   * — identical treatment to `pickFile`, which is the point: a folder is not a
   * second-class attachment here, and it is NOT a typed artifact, so it carries
   * no digest claim. Typed inputs never use this; they use
   * `pickRunInput({ selection: 'directory' })`, which freezes the folder. */
  pickDirectory?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
  /** Trusted typed-input boundary. Desktop hashes/registers the local file and
   * retains its path locally; web/backend receive identity + media metadata only. */
  pickRunInput?: (opts: {
    inputKey: string;
    inputSessionId?: string;
    selection?: 'file' | 'directory';
    accept?: { mediaTypes?: string[]; extensions?: string[]; directorySnapshot?: boolean };
    /** The one prior binding this same open form is replacing. Desktop releases
     * it only after the new registration succeeds and only if session + key
     * also match; it never performs age-based cleanup of queued-run inputs. */
    replacesArtifactId?: string;
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
    storageMode?: LocalInputStorageMode;
  }>;
  /** Subscribe before opening the picker: hashing may begin immediately after
   * the native dialog resolves. The returned function removes this listener. */
  onRunInputProgress?: (cb: (progress: RunInputProgress) => void) => (() => void);
  /** Stop one exact verification operation. Cancellation never targets an
   * input key globally, because another surface may be verifying the same key. */
  cancelRunInputVerification?: (operationId: string) => Promise<{
    ok: boolean;
    canceled?: boolean;
    error?: string;
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
    storageMode?: LocalInputStorageMode;
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
  const [canAttachFolder, setCanAttachFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCanAttach(!!desktopBridge()?.pickFile);
    setCanAttachFolder(!!desktopBridge()?.pickDirectory);
  }, []);

  async function attachFile() {
    setError(null);
    const bridge = desktopBridge();
    if (!bridge?.pickFile) return;
    const r = await bridge.pickFile().catch(() => null);
    if (r?.ok && r.path) {
      setFiles((prev) => (prev.includes(r.path!) ? prev : [...prev, r.path!].slice(0, MAX_RUN_FILES)));
    }
  }
  /**
   * A refusal is SHOWN. A cancel is not.
   *
   * Both used to be the same `return`, which meant a folder picker that failed
   * — no permission, a dialog that threw, a Desktop that does not have the
   * channel — looked exactly like the user changing their mind: the dialog
   * closed, nothing appeared, and there was nothing to read.
   */
  async function attachFolder() {
    const bridge = desktopBridge();
    if (!bridge?.pickDirectory) {
      setError('Open this run in the Implexa desktop app to attach a folder.');
      return;
    }
    setError(null);
    const r: { ok: boolean; path?: string; canceled?: boolean; error?: string } =
      await bridge.pickDirectory().catch((e: unknown) => ({
        ok: false, error: e instanceof Error ? e.message : 'bridge_unavailable',
      }));
    if (r?.ok && r.path) {
      setFiles((prev) => (prev.includes(r.path!) ? prev : [...prev, r.path!].slice(0, MAX_RUN_FILES)));
      return;
    }
    // An older Desktop reports a cancel as a bare `{ ok:false }`, so "no code"
    // is read as a cancel — the same convention the typed picker uses.
    if (r?.canceled === true || !r?.error) return;
    setError(describeFolderAttachError(r.error));
  }
  function removeFile(i: number) {
    setError(null);
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }
  function reset() { setFiles([]); setError(null); }

  return { files, setFiles, canAttach, canAttachFolder, attachFile, attachFolder, removeFile, reset, error };
}

/** The attach button + attached-file chips. Desktop-only (disabled with a hint in a
 *  plain browser, which can't hand Claude a local path). */
/** Turn a Desktop folder-picker refusal into something the user can act on. */
export function describeFolderAttachError(code: string | undefined): string {
  switch (code) {
    case 'forbidden':
      return 'Implexa Desktop would not accept this page. Open this run from the Implexa desktop app window and try again.';
    case 'folder_picker_failed':
      return 'Implexa Desktop could not open a folder picker. Try again, or attach the files individually.';
    case 'bridge_unavailable':
      return 'Implexa Desktop did not respond. Make sure it is running, then try again.';
    default:
      return `Could not attach that folder (${code}). Try again, or attach the files individually.`;
  }
}

export function AttachFiles({
  files, canAttach, canAttachFolder = false, onAttach, onAttachFolder, onRemove, error = null,
  hint = 'A screenshot, file, or folder — the run reads it as context.',
}: {
  files: string[];
  canAttach: boolean;
  canAttachFolder?: boolean;
  onAttach: () => void;
  onAttachFolder?: () => void;
  onRemove: (i: number) => void;
  error?: string | null;
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
        {canAttachFolder && onAttachFolder && <button
          type="button"
          onClick={onAttachFolder}
          disabled={files.length >= MAX_RUN_FILES}
          title="Attach a folder for this run"
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 text-ink-300 px-2.5 py-1.5 text-xs hover:border-ink-500 hover:text-ink-100 transition-colors disabled:opacity-40"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          Attach folder
        </button>}
        {(canAttach || canAttachFolder) && <span className="text-[11px] text-ink-500">{hint}</span>}
      </div>

      {error && <p role="alert" className="mt-1.5 text-[11px] text-rose-300">{error}</p>}

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
