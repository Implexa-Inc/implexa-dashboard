'use client';

/**
 * <RunMarkdown> — the ONE markdown renderer for a run's deliverable, shared by
 * the run permalink (/runs/[id]) and the Results overlay (/inbox). Both used to
 * call ReactMarkdown directly with identical plugins; centralizing it here means
 * the clickable-file-path behavior is byte-identical everywhere a deliverable
 * renders.
 *
 * The one enhancement over a plain renderer: inline code that LOOKS like a file
 * or folder path (`reels/day-18/`, `REEL_BRIEF.md`, `avatar.mp4`) becomes a
 * subtle clickable affordance via <FilePathCode>. Everything else — cron
 * strings (`0 9 * * *`), tool names (`run_agent_now`), shell commands
 * (`npm run build`), URLs — renders exactly as before.
 *
 * Click resolves the path against the user's workspace root (run-env) and, when
 * the desktop bridge exposes openPath/revealPath, opens/reveals it in place;
 * otherwise it copies the (absolute, or relative if the root is unknown) path so
 * the user can ⌘⇧G straight to it. It never silently does nothing.
 */

import { useCallback, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

// Extensions we treat as a file path. Readable text files OPEN in the default
// app; binaries (and folders) REVEAL in Finder.
const PATH_EXT =
  /\.(md|mdx|txt|tsx|ts|jsx|js|json|csv|png|jpe?g|gif|mp4|mov|wav|mp3|pdf|html|css|py|sh)$/i;
const READABLE = new Set([
  'md', 'mdx', 'txt', 'tsx', 'ts', 'jsx', 'js', 'json', 'csv', 'html', 'css', 'py', 'sh',
]);

// The desktop preload bridge. handoffAgent ships today; openPath/revealPath are
// the (optional) additions documented in the chip report — feature-detected so
// this lights up the day the desktop app exposes them, with no dashboard change.
type DesktopBridge = {
  handoffAgent?: (...a: unknown[]) => unknown;
  openPath?: (abs: string) => Promise<{ ok: boolean }> | void;
  revealPath?: (abs: string) => Promise<{ ok: boolean }> | void;
};

/** Conservative path detector — true only for code that's clearly a path. */
function looksLikePath(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;     // commands, cron strings, prose
  if (s.includes('://')) return false; // URLs go through the link renderer
  if (s.endsWith('/')) return true;    // a folder
  if (PATH_EXT.test(s)) return true;   // a known file extension
  if (s.includes('/')) return true;    // otherwise path-shaped (has a slash)
  return false;
}

function lastExt(s: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(s.trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * Resolve a relative deliverable path to an absolute one UNDER the workspace
 * root. Returns null (→ copy-relative fallback) when the root is unknown, the
 * path tries to traverse out (`..`), or an absolute path escapes the root.
 */
function resolveAbs(root: string | null | undefined, rel: string): string | null {
  if (!root) return null;
  const base = root.replace(/\/+$/, '');
  const p = rel.trim().replace(/^\.\//, '');
  if (!p) return null;
  if (p.startsWith('/')) {
    // Already absolute — only honor it if it lives under the workspace root.
    return p === base || p.startsWith(`${base}/`) ? p : null;
  }
  if (p.split('/').includes('..')) return null; // no traversal outside the root
  const abs = `${base}/${p}`;
  return abs.startsWith(`${base}/`) ? abs : null;
}

function FolderIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"
      className="mr-0.5 inline-block align-[-1px] opacity-60">
      <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4.5Z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"
      className="mr-0.5 inline-block align-[-1px] opacity-60">
      <path d="M3.5 1.5h6L13 5v9.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function FilePathCode({
  text,
  className,
  workspaceRoot,
}: {
  text: string;
  className?: string;
  workspaceRoot?: string | null;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const trimmed = text.trim();
  const isFolder = trimmed.endsWith('/');
  const readable = !isFolder && READABLE.has(lastExt(trimmed));

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const onActivate = useCallback(async () => {
    const abs = resolveAbs(workspaceRoot, trimmed);
    const bridge =
      typeof window !== 'undefined'
        ? (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop
        : undefined;

    // In-app open/reveal when the desktop bridge supports it and we resolved a
    // path under the workspace root.
    if (abs && bridge) {
      try {
        if (readable && typeof bridge.openPath === 'function') {
          await bridge.openPath(abs);
          flash('Opening…');
          return;
        }
        if (!readable && typeof bridge.revealPath === 'function') {
          await bridge.revealPath(abs);
          flash('Revealing in Finder…');
          return;
        }
        // Bridge present but missing the method we need → copy fallback below.
      } catch {
        /* fall through to copy */
      }
    }

    // Plain browser (or bridge without open/reveal): copy so the user can paste
    // into Finder's Go to Folder (⌘⇧G). Never silently no-op.
    const toCopy = abs || trimmed;
    try {
      await navigator.clipboard.writeText(toCopy);
      flash(abs ? 'Copied — ⌘⇧G in Finder' : 'Copied relative path');
    } catch {
      flash('Copy failed');
    }
  }, [workspaceRoot, trimmed, readable]);

  const Icon = isFolder ? FolderIcon : FileIcon;
  return (
    <span className="inline-flex items-baseline gap-0.5 align-baseline">
      <code
        className={`${className ?? ''} cursor-pointer hover:underline decoration-dotted underline-offset-2`}
        role="button"
        tabIndex={0}
        title={`${readable ? 'Open' : 'Reveal'} ${trimmed}`}
        aria-label={`${readable ? 'Open' : 'Reveal'} ${trimmed}`}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        }}
      >
        <Icon />
        {text}
      </code>
      {toast && (
        <span className="ml-1 text-[10px] text-ink-500 not-prose" aria-live="polite">
          {toast}
        </span>
      )}
    </span>
  );
}

export default function RunMarkdown({
  markdown,
  workspaceRoot,
}: {
  markdown: string;
  workspaceRoot?: string | null;
}) {
  const components: Components = {
    code(props) {
      const { className, children, ...rest } = props as {
        className?: string;
        children?: React.ReactNode;
      };
      const raw = Array.isArray(children)
        ? children.join('')
        : String(children ?? '');
      // Block code (fenced / highlighted) keeps its normal rendering; we only
      // linkify single-line INLINE code that's path-shaped.
      const isBlock = /\blanguage-/.test(className || '') || raw.includes('\n');
      if (isBlock || !looksLikePath(raw)) {
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      }
      return <FilePathCode text={raw} className={className} workspaceRoot={workspaceRoot} />;
    },
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
}
