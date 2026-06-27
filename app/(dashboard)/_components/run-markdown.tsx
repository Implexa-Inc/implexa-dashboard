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

import { useCallback, useMemo, useState } from 'react';
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
  openPath?: (abs: string) => Promise<{ ok: boolean; error?: string }> | void;
  revealPath?: (abs: string) => Promise<{ ok: boolean; error?: string }> | void;
};

/**
 * A SCHEME-LESS URL written as inline code, e.g. `implexa.ai/guides/day-20` or a
 * bare `implexa.ai`. Agents routinely cite a page without the `https://`, and the
 * old path detector saw the slash and rendered it as a clickable FILE PATH — so
 * clicking tried to open a local file that doesn't exist (the founder's "the links
 * don't work"). Detect a real domain so we can render it as an external link. The
 * host (text before the first `/`) must be domain-shaped with a 2+ letter TLD, and
 * the whole thing must NOT end in a known file extension (so `config.json` /
 * `REEL_BRIEF.md` stay file paths, not URLs).
 */
function looksLikeBareUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s || /\s/.test(s) || s.includes('://')) return false;
  if (PATH_EXT.test(s)) return false;          // a file (config.json), not a URL
  const host = (s.includes('/') ? s.slice(0, s.indexOf('/')) : s).toLowerCase();
  // label(.label)+ with a 2+ letter TLD; underscores (REEL_BRIEF) excluded.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && /\.[a-z]{2,}$/.test(host);
}

/** Conservative path detector — true only for code that's clearly a path. */
function looksLikePath(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (s.includes('://')) return false; // URLs go through the link renderer
  if (looksLikeBareUrl(s)) return false; // scheme-less URL → link, not a path
  // Real paths routinely contain SPACES ("Sanna Reels", "Implexa Agents"), so we
  // can't blanket-reject whitespace. A SPACED string is a path only when it's
  // unambiguously one — path-shaped (leading /, ~/, ./ or a slash) AND ending in a
  // known file extension or a trailing slash (folder). That admits
  // "/…/Sanna Reels/…/launch_reel.mp4" while still rejecting prose/commands/cron.
  const pathShaped = s.startsWith('/') || s.startsWith('~/') || s.startsWith('./') || s.includes('/');
  if (/\s/.test(s)) {
    return pathShaped && (s.endsWith('/') || PATH_EXT.test(s));
  }
  // No whitespace → the original conservative rules.
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
 * The folder a deliverable's artifacts live in. Agents routinely list files as
 * BARE names under an "Artifacts (in `reels/day-18/`)" heading — those resolve
 * to the workspace ROOT (where they don't exist) unless we re-base them onto the
 * artifact folder. Prefer an explicit "in `dir/`" marker; else the first
 * folder-shaped inline-code path in the doc. Null when there's no folder context.
 */
function deriveArtifactDir(md: string): string | null {
  const clean = (s: string) => s.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  const marker = md.match(/\bin\s+`([^`\n]+?\/)`/i);
  if (marker && !marker[1].includes('://') && !/\s/.test(marker[1])) return clean(marker[1]);
  for (const m of md.matchAll(/`([^`\n]+?\/)`/g)) {
    if (!m[1].includes('://') && !/\s/.test(m[1])) return clean(m[1]);
  }
  return null;
}

/**
 * Resolve a relative deliverable path to an absolute one UNDER the workspace
 * root. Returns null (→ copy-relative fallback) when the root is unknown, the
 * path tries to traverse out (`..`), or an absolute path escapes the root.
 */
function resolveAbs(root: string | null | undefined, rel: string): string | null {
  const p = rel.trim().replace(/^\.\//, '');
  if (!p) return null;
  // Home-relative (`~/…`) is already rooted at the user's home. The browser can't
  // expand `~`, so pass it through untouched — the desktop bridge expands it to the
  // real home. Agent deliverables routinely print `~/…` paths, so this is common.
  if (p === '~' || p.startsWith('~/')) {
    return p.split('/').includes('..') ? null : p;
  }
  // Already absolute → pass it through to the desktop bridge, which enforces it's
  // under the user's home (allowedLocalPath) + basename-falls-back if the file
  // moved. Do NOT pre-reject paths outside the workspace root: agents run in their
  // OWN working dirs (e.g. ~/Implexa/broll-…), so a perfectly valid full path that
  // isn't under the configured root was dead-ending on "copy" instead of opening.
  // (`..` collapses safely via path.resolve on the desktop; web just copies it.)
  if (p.startsWith('/')) return p;
  // Home-rooted relative path: agents (and hand-written run notes) routinely print
  // paths relative to $HOME like "revenoid-workspace/…", "Implexa Agents/…", or
  // "Downloads/clip.mov" — NOT relative to the artifact dir. Anchor those at ~ so
  // the bridge (which expands ~ and basename-falls-back) can open them; without
  // this they dead-ended on copy. Only first-segments that are real ~/ children.
  if (/^(revenoid-workspace|Implexa|Implexa Agents|Downloads|Desktop|Documents|\.claude|\.config)\//.test(p)) {
    return p.split('/').includes('..') ? null : `~/${p}`;
  }
  if (!root) return null;
  const base = root.replace(/\/+$/, '');
  if (p.split('/').includes('..')) return null; // no traversal outside the root
  const abs = `${base}/${p}`;
  return abs.startsWith(`${base}/`) ? abs : null;
}

// Decode a percent-encoded path (markdown link hrefs encode spaces etc.) back to
// the real on-disk path. No-op when there's nothing to decode; returns the raw
// string on a malformed escape so a stray "%" in a filename never throws.
function decodePath(s: string): string {
  if (!s || !s.includes('%')) return s;
  try { return decodeURIComponent(s); } catch { return s; }
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
  label,
  className,
  workspaceRoot,
  artifactDir,
}: {
  text: string;
  /** Visible label (e.g. a markdown link's text). Falls back to the full path. */
  label?: React.ReactNode;
  className?: string;
  workspaceRoot?: string | null;
  artifactDir?: string | null;
}) {
  const [toast, setToast] = useState<string | null>(null);
  // A markdown LINK href arrives URL-ENCODED — a path like "~/Implexa Agents/…"
  // becomes "~/Implexa%20Agents/…". That encoded string was used for BOTH the
  // tooltip AND the actual reveal path, so the %20 never matched the real
  // "Implexa Agents" folder → "path not found" (founder hit this). Decode it back
  // (no-op for code-span paths, which aren't encoded; raw on any bad escape).
  const trimmed = decodePath(text).trim();
  const isFolder = trimmed.endsWith('/');
  const readable = !isFolder && READABLE.has(lastExt(trimmed));

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const onActivate = useCallback(async () => {
    // A BARE filename (no slash) listed under an artifact-folder heading lives in
    // that folder, not at the root — re-base it so it actually resolves.
    const rel =
      artifactDir && !trimmed.includes('/') ? `${artifactDir}/${trimmed}` : trimmed;
    const abs = resolveAbs(workspaceRoot, rel);
    const bridge =
      typeof window !== 'undefined'
        ? (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop
        : undefined;

    // In-app open/reveal when the desktop bridge supports it and we resolved a
    // path under the workspace root. CRUCIAL: honor the bridge's {ok} result —
    // a bare "Opening…" toast that fires even when the IPC returned ok:false is
    // a silent lie (the file didn't exist / was outside the workspace, so
    // nothing happened). Report the real reason and copy the path so the user
    // can still get there.
    if (abs && bridge) {
      const act = readable ? bridge.openPath : bridge.revealPath;
      if (typeof act === 'function') {
        try {
          const res = await act(abs);
          // Legacy bridge returns void → can't verify; assume it acted.
          if (!res || res.ok) {
            flash(readable ? 'Opening…' : 'Revealing in Finder…');
            return;
          }
          const why =
            res.error === 'not-found'
              ? "Couldn't find that file on disk"
              : res.error === 'path-not-allowed'
                ? 'That path is outside your workspace folder'
                : "Couldn't open that file";
          try {
            await navigator.clipboard.writeText(abs);
            flash(`${why} — copied the path`);
          } catch {
            flash(why);
          }
          return;
        } catch {
          /* fall through to copy */
        }
      }
      // Bridge present but missing the method we need → copy fallback below.
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
  }, [workspaceRoot, trimmed, readable, artifactDir]);

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
        {label ?? text}
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
  // Agents write file deliverables as markdown links — [REEL_BRIEF.md](~/Implexa
  // Agents/.../REEL_BRIEF.md). The path has a SPACE ("Implexa Agents"), which
  // CommonMark won't accept as a bare link destination, so the whole link rendered
  // as dead plain text (the founder: "file links aren't clickable any more").
  // Angle-bracket-wrap any local-path link destination that contains a space so it
  // parses into a real link node, which the `a` renderer below turns into a
  // clickable file chip. Only touches non-URL, not-already-wrapped destinations.
  const prepared = useMemo(
    () => markdown.replace(/\]\(([^)<>]*?)\)/g, (m, dest: string) => {
      const d = dest.trim();
      if (!d || !/\s/.test(d)) return m;                       // no space → fine as-is
      if (/^https?:\/\//i.test(d) || /^mailto:/i.test(d)) return m; // real URL → leave
      return `](<${d}>)`;
    }),
    [markdown],
  );
  const artifactDir = useMemo(() => deriveArtifactDir(prepared), [prepared]);
  const components: Components = {
    // Markdown LINKS: an external URL opens in a new tab; a LOCAL FILE PATH href
    // (~/, /abs, or a home-rooted relative) becomes a clickable file chip (same
    // open/reveal-via-bridge behavior as a coded path), labelled with the link text.
    a(props) {
      const { href, children } = props as { href?: string; children?: React.ReactNode };
      const dest = (href || '').trim();
      if (/^https?:\/\//i.test(dest) || /^mailto:/i.test(dest)) {
        return (
          <a href={dest} target="_blank" rel="noopener noreferrer"
            className="text-brand-500 hover:underline break-all">
            {children}
          </a>
        );
      }
      const isLocalPath = !!dest && (dest.startsWith('~') || dest.startsWith('/') || looksLikePath(dest));
      if (isLocalPath) {
        return (
          <FilePathCode
            text={dest}
            label={children}
            workspaceRoot={workspaceRoot}
            artifactDir={artifactDir}
          />
        );
      }
      return <a href={dest} className="text-brand-500 hover:underline break-all">{children}</a>;
    },
    code(props) {
      const { className, children, ...rest } = props as {
        className?: string;
        children?: React.ReactNode;
      };
      const raw = Array.isArray(children)
        ? children.join('')
        : String(children ?? '');
      // Block code (fenced / highlighted) keeps its normal rendering; we only
      // linkify single-line INLINE code.
      const isBlock = /\blanguage-/.test(className || '') || raw.includes('\n');
      // A scheme-less URL (implexa.ai/guides/day-20) → a real, clickable external
      // link (opens in a new tab) instead of a dead file-path chip.
      if (!isBlock && looksLikeBareUrl(raw)) {
        const href = `https://${raw.trim()}`;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-brand-500 hover:underline break-all">
            {children}
          </a>
        );
      }
      if (isBlock || !looksLikePath(raw)) {
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      }
      return (
        <FilePathCode
          text={raw}
          className={className}
          workspaceRoot={workspaceRoot}
          artifactDir={artifactDir}
        />
      );
    },
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={components}
    >
      {prepared}
    </ReactMarkdown>
  );
}
