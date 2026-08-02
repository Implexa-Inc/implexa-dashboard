/**
 * lib/review-preview.ts — deciding whether an artifact can be previewed, and how.
 *
 * THE BROWSER CANNOT OPEN LOCAL FILES. Only the Implexa desktop app can, through the
 * authorized `implexa-artifact://` protocol (Desktop B), and it hands back an opaque
 * token URL — never a path. Nothing in this module accepts, stores, or renders a
 * filesystem path, and the review packet does not carry one.
 *
 * Every "cannot preview" case gets its OWN state, because they call for different
 * words and different buttons:
 *
 *   desktop_required          ordinary browser -> "Open in Implexa Desktop"
 *   update_required           in the app, but this build has no preview bridge ->
 *                             "Update Implexa to preview local files."
 *   not_validated             a declared/rejected artifact -> unproven bytes, refuse
 *   unsupported               a real file we cannot render inline -> explain + offer
 *                             Open externally / Finder, NEVER an empty black player
 *   changed_since_validation  size/mtime moved since validation -> the bytes on disk
 *                             are no longer the bytes that were reviewed
 *   unavailable               the desktop said no / the call failed -> which is NOT
 *                             "the file is missing"; we do not know that
 *   loading | ready           the normal path
 *
 * Conflating `unavailable` with "file missing" is the specific lie this file refuses:
 * a failed authorization tells us nothing about whether the file exists.
 */

export type PreviewState =
  | 'loading'
  | 'ready'
  | 'unsupported'
  | 'unavailable'
  | 'changed_since_validation'
  | 'desktop_required'
  | 'update_required'
  | 'not_validated';

/** What kind of viewer an artifact needs. */
export type PreviewKind = 'video' | 'audio' | 'image' | 'text' | 'pdf' | 'unsupported';

type DesktopBridge = {
  createArtifactPreview?: (runId: string, artifactId: string) => Promise<unknown>;
  revokeArtifactPreview?: (token: string) => Promise<unknown>;
};
type WindowWithBridge = Window & { implexaDesktop?: DesktopBridge };

/**
 * The v0 inline allowlist (spec §3). Extension-based ON PURPOSE: the desktop
 * re-derives MIME itself and is the authority. MOV is deliberately absent — Chromium
 * can sometimes decode it, and "sometimes" is not a promise we make.
 */
const KIND_BY_EXT: Record<string, PreviewKind> = {
  mp4: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image',
  md: 'text', txt: 'text', json: 'text', csv: 'text',
  pdf: 'pdf',
};

/**
 * Which viewer a file needs, decided from its FINAL PATH SEGMENT only.
 *
 * DEFENCE IN DEPTH, not a bug fix. The original was already safe by construction: it
 * looked the remainder up in KIND_BY_EXT, so anything odd simply missed the map and
 * returned 'unsupported'. Mutating the two checks below does not fail a test, and that
 * is reported honestly rather than dressed up. They stay because they make the intent
 * explicit and keep the parser safe if that map is ever replaced by a looser lookup.
 *
 * The desktop remains the MIME authority; this only decides which viewer to draw.
 */
export function previewKind(relativePath: string | null | undefined): PreviewKind {
  const raw = String(relativePath || '');
  // Both separators, so a Windows-shaped value cannot smuggle a segment through.
  const base = raw.split(/[/\\]/).pop() ?? '';
  if (!base || base === '.' || base === '..') return 'unsupported';
  const dot = base.lastIndexOf('.');
  // dot === 0 is a dotfile (".mp4"), which has a name but no extension.
  if (dot <= 0 || dot === base.length - 1) return 'unsupported';
  const ext = base.slice(dot + 1).toLowerCase();
  // Anything but plain alphanumerics is not an extension we will act on.
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return 'unsupported';
  return KIND_BY_EXT[ext] ?? 'unsupported';
}

/** Does THIS build of the desktop app expose the preview bridge? */
export function desktopPreviewSupported(win?: unknown): boolean {
  const w = (win ?? (typeof window !== 'undefined' ? window : undefined)) as WindowWithBridge | undefined;
  return typeof w?.implexaDesktop?.createArtifactPreview === 'function';
}

/** Are we inside the desktop app at all (any build)? */
export function inDesktopApp(win?: unknown): boolean {
  const w = (win ?? (typeof window !== 'undefined' ? window : undefined)) as WindowWithBridge | undefined;
  return !!w?.implexaDesktop;
}

export type PreviewDecision = {
  state: PreviewState;
  kind: PreviewKind;
  /** One honest sentence for the surface. */
  message: string;
  /** Offer "Open in Implexa Desktop"? */
  offerOpenInDesktop: boolean;
  /** Offer Open externally / Reveal in Finder (desktop only, real file, wrong type)? */
  offerExternal: boolean;
};

const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Preserve the review identity across the browser -> Desktop handoff.
 *
 * `implexa://review` opens the queue. A run detail page using that generic link loses
 * the exact run the user was looking at, so even a healthy Desktop cannot open the
 * local artifact they asked to review. Fail closed on malformed ids rather than place
 * attacker-controlled path material into the custom protocol URL.
 */
export function desktopReviewHref(runId: string): string | null {
  return RUN_ID_RE.test(runId) ? `implexa://review/${runId}` : null;
}

/**
 * Decide BEFORE asking the desktop for anything. Pure, so every branch is testable.
 *
 * Order matters: validation status is checked before capability, because an unproven
 * artifact must be refused even in a fully capable desktop — presenting declared bytes
 * as reviewed evidence is worse than refusing to draw a player.
 */
export function decidePreview(args: {
  artifact: { status?: string | null; relativePath?: string | null } | null | undefined;
  inDesktop: boolean;
  bridgeSupported: boolean;
}): PreviewDecision {
  const { artifact, inDesktop, bridgeSupported } = args;
  const kind = previewKind(artifact?.relativePath);

  if (!artifact) {
    return { state: 'unavailable', kind, offerOpenInDesktop: false, offerExternal: false,
      message: 'No artifact selected for review.' };
  }

  // Unproven bytes are never previewed as evidence, in any surface.
  if (artifact.status !== 'validated') {
    return {
      state: 'not_validated', kind, offerOpenInDesktop: false, offerExternal: false,
      message: artifact.status === 'rejected'
        ? 'This file failed validation, so it cannot be reviewed as the delivered result.'
        : 'This file was declared by the agent but has not been independently validated yet, so it cannot be previewed as evidence.',
    };
  }

  if (!inDesktop) {
    return {
      state: 'desktop_required', kind, offerOpenInDesktop: true, offerExternal: false,
      message: 'Local files can only be opened in Implexa Desktop. Your browser cannot read them.',
    };
  }

  if (!bridgeSupported) {
    // In the app, but this build predates the preview protocol.
    return {
      state: 'update_required', kind, offerOpenInDesktop: false, offerExternal: false,
      message: 'Update Implexa to preview local files.',
    };
  }

  if (kind === 'unsupported') {
    return {
      state: 'unsupported', kind, offerOpenInDesktop: false, offerExternal: true,
      message: 'This file type cannot be shown inline. You can open it in another app instead.',
    };
  }

  return { state: 'loading', kind, offerOpenInDesktop: false, offerExternal: true, message: '' };
}

/**
 * Interpret what the desktop bridge came back with.
 *
 * `changed_since_validation` is its own answer: the file is there, but its size/mtime
 * moved since it was validated, so the bytes on disk are no longer the bytes that were
 * reviewed — anchoring feedback to them would be anchoring to something else.
 *
 * A refusal or a thrown error is `unavailable`, explicitly NOT "file missing". We
 * asked and did not get an answer; that says nothing about whether the file exists.
 */
export function interpretPreviewResult(result: unknown, kind: PreviewKind): PreviewDecision {
  const r = result as { ok?: boolean; url?: string; state?: string; error?: string } | null | undefined;

  // Uses THE parser, not a second weaker copy of it. Previously this accepted any
  // string starting with the scheme while the renderer applied a different (also
  // porous) rule — two parsers that could disagree about the same value.
  if (r && r.ok && parsePreviewUrl(r.url) !== null) {
    return { state: 'ready', kind, message: '', offerOpenInDesktop: false, offerExternal: true };
  }
  if (r && r.state === 'changed_since_validation') {
    return {
      state: 'changed_since_validation', kind, offerOpenInDesktop: false, offerExternal: true,
      message: 'This file has changed on disk since it was validated, so it is no longer the version that was reviewed.',
    };
  }
  return {
    state: 'unavailable', kind, offerOpenInDesktop: false, offerExternal: true,
    // Deliberately does not say "missing" or "deleted" — we do not know that.
    message: 'Implexa could not open this file for review just now. That does not mean the file is gone.',
  };
}

/**
 * Ask the desktop for a preview. Returns ONLY the opaque token URL it minted.
 *
 * A run/artifact id pair is all that is ever sent; no path is passed in either
 * direction, so the renderer cannot leak one even by accident.
 */
export async function requestPreview(runId: string, artifactId: string): Promise<unknown> {
  const w = (typeof window !== 'undefined' ? window : undefined) as WindowWithBridge | undefined;
  const create = w?.implexaDesktop?.createArtifactPreview;
  if (typeof create !== 'function') return { ok: false, error: 'unsupported' };
  try {
    return await create(runId, artifactId);
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/**
 * The text body of a text-like artifact, taken FROM THE BRIDGE RESPONSE.
 *
 * Not fetched from the preview URL: Chromium refuses fetch() to a non-http(s) scheme
 * from an http(s) page before any handler runs, so reading the body that way fails for
 * every text artifact. Media/image elements are no-cors and unaffected, which is exactly
 * why the gap was invisible — the videos worked.
 *
 * Returns null when the desktop did not supply text, so the caller can say "could not
 * read this" rather than render an empty pane that looks like an empty file. An empty
 * STRING is a legitimate answer (the artifact really is empty) and is preserved.
 */
export function previewText(result: unknown): string | null {
  const r = result as { ok?: boolean; text?: unknown } | null | undefined;
  if (!r || r.ok !== true) return null;
  return typeof r.text === 'string' ? r.text : null;
}

/** Was that text clipped at the desktop's cap? A clipped file must never look whole. */
export function previewTextTruncated(result: unknown): boolean {
  const r = result as { textTruncated?: unknown } | null | undefined;
  return r?.textTruncated === true;
}

export async function revokePreview(token: string | null | undefined): Promise<void> {
  if (!token) return;
  const w = (typeof window !== 'undefined' ? window : undefined) as WindowWithBridge | undefined;
  const revoke = w?.implexaDesktop?.revokeArtifactPreview;
  if (typeof revoke !== 'function') return;
  try { await revoke(token); } catch { /* revocation is best-effort; the token also expires */ }
}

/**
 * THE preview-URL parser. One implementation, used by every consumer.
 *
 * ALLOWLIST, NOT DENYLIST. The first version blocked the literal string "/Users/" and
 * accepted everything else, so `implexa-artifact:///home/me/a.mp4`,
 * `implexa-artifact:///var/folders/x/final.mp4`,
 * `implexa-artifact://preview/../../etc/passwd` and a Windows path all sailed through.
 * A guard that enumerates the bad shapes is only ever as good as the author's
 * imagination; this one enumerates the single GOOD shape instead:
 *
 *     implexa-artifact://preview/<opaque-token>
 *
 * where the token is url-safe base64/hex — no separators, no dots, no traversal, no
 * percent-encoding, nothing that could carry a path. Anything else is refused.
 *
 * Returns the token so the caller can revoke it, or null when the URL is not one of
 * ours. Two parsers of the same value can disagree; there is now only one.
 */
const PREVIEW_URL_RE = /^implexa-artifact:\/\/preview\/([A-Za-z0-9_-]{16,512})$/;

export function parsePreviewUrl(url: unknown): { token: string } | null {
  if (typeof url !== 'string') return null;
  const m = PREVIEW_URL_RE.exec(url);
  return m ? { token: m[1] } : null;
}

/**
 * A path must never reach this layer. Exported so the renderer can assert it on any
 * value it is about to put in a `src`, and so the test suite can prove the rule.
 */
export function isSafePreviewUrl(url: unknown): boolean {
  return parsePreviewUrl(url) !== null;
}
