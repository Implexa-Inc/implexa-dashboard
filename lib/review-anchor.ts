/**
 * lib/review-anchor.ts — building the typed anchor a review issue attaches to.
 *
 * The anchor's identity is (artifact digest, location). The digest is copied from the
 * VALIDATED artifact record, and the backend re-checks it on every write — so an
 * anchor built against a file that has since changed is refused as stale rather than
 * silently re-pointing the comment at different bytes.
 *
 * This mirrors the backend validator (src/lib/review-anchor.js) so an invalid anchor
 * is caught here, before a round trip. It deliberately does NOT relax any rule: if the
 * two ever disagree, the backend wins and the user sees a refusal — which is the
 * correct direction for a disagreement about evidence.
 */

export type MediaAnchor = {
  version: 1; type: 'media_time'; artifactSha256: string;
  timeStartMs: number; timeEndMs: number | null;
};
export type TextAnchor = {
  version: 1; type: 'text_selection'; artifactSha256: string;
  startOffset: number; endOffset: number; quote: string;
};
export type PdfAnchor = { version: 1; type: 'pdf_text'; artifactSha256: string; page: number; quote: string };
export type ArtifactAnchor = { version: 1; type: 'artifact'; artifactSha256: string };
export type ReviewAnchor = MediaAnchor | TextAnchor | PdfAnchor | ArtifactAnchor;

export const QUOTE_MAX = 1000;
export const BODY_MAX = 4000;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Media element time -> milliseconds.
 *
 * ROUNDED, not truncated: an anchor is what the reviewer SAW when they paused, and
 * floor() would systematically drift the mark earlier than the frame on screen. The
 * backend requires a non-negative integer, so a float here is refused outright.
 */
export function currentTimeToMs(currentTimeSeconds: number): number {
  if (!Number.isFinite(currentTimeSeconds) || currentTimeSeconds < 0) return 0;
  return Math.round(currentTimeSeconds * 1000);
}

export function buildMediaAnchor(sha256: string, startSeconds: number, endSeconds?: number | null): MediaAnchor {
  const timeStartMs = currentTimeToMs(startSeconds);
  const timeEndMs = endSeconds === undefined || endSeconds === null ? null : currentTimeToMs(endSeconds);
  return { version: 1, type: 'media_time', artifactSha256: sha256, timeStartMs, timeEndMs };
}

export function buildTextAnchor(sha256: string, startOffset: number, endOffset: number, quote: string): TextAnchor {
  return {
    version: 1, type: 'text_selection', artifactSha256: sha256,
    startOffset: Math.max(0, Math.floor(startOffset)),
    endOffset: Math.max(0, Math.floor(endOffset)),
    // Bounded here so an accidental select-all cannot produce a body the backend
    // refuses after the user has already written their comment.
    quote: String(quote || '').slice(0, QUOTE_MAX),
  };
}

export function buildArtifactAnchor(sha256: string): ArtifactAnchor {
  return { version: 1, type: 'artifact', artifactSha256: sha256 };
}

/** Same rules as the backend. Returns null when valid, else why not. */
export function anchorError(anchor: ReviewAnchor | null | undefined): string | null {
  if (!anchor || typeof anchor !== 'object') return 'An anchor is required.';
  if (anchor.version !== 1) return 'Unsupported anchor version.';
  if (!SHA256_RE.test(String((anchor as ArtifactAnchor).artifactSha256 || ''))) {
    return 'This artifact has no validated digest to anchor to.';
  }
  if (anchor.type === 'media_time') {
    const a = anchor as MediaAnchor;
    if (!Number.isInteger(a.timeStartMs) || a.timeStartMs < 0) return 'The start time is not a valid position.';
    if (a.timeEndMs !== null) {
      if (!Number.isInteger(a.timeEndMs) || a.timeEndMs < 0) return 'The end time is not a valid position.';
      if (a.timeEndMs < a.timeStartMs) return 'The end of the range must come after the start.';
    }
    return null;
  }
  if (anchor.type === 'text_selection') {
    const a = anchor as TextAnchor;
    if (!Number.isInteger(a.startOffset) || a.startOffset < 0) return 'The selection start is invalid.';
    if (!Number.isInteger(a.endOffset) || a.endOffset < a.startOffset) return 'The selection end must come after the start.';
    if (!a.quote) return 'Select some text to comment on.';
    if (a.quote.length > QUOTE_MAX) return 'That selection is too long to quote.';
    return null;
  }
  if (anchor.type === 'pdf_text') {
    const a = anchor as PdfAnchor;
    if (!Number.isInteger(a.page) || a.page < 1) return 'Invalid page number.';
    if (!a.quote) return 'Select some text to comment on.';
    return null;
  }
  if (anchor.type === 'artifact') return null;
  return 'Unsupported anchor type.';
}

export function bodyError(body: string): string | null {
  const t = String(body || '').trim();
  if (!t) return 'Describe what should change.';
  if (t.length > BODY_MAX) return `Keep it under ${BODY_MAX} characters.`;
  return null;
}

/**
 * Has the artifact changed under an existing anchor?
 *
 * A stale anchor must be shown as stale, never silently re-highlighted against
 * different bytes — the comment was about something that is no longer there.
 */
export function isAnchorStale(
  anchor: { artifactSha256?: string } | null | undefined,
  artifact: { sha256?: string | null; status?: string | null } | null | undefined,
): boolean {
  if (!anchor?.artifactSha256 || !artifact) return true;
  if (artifact.status !== 'validated') return true;
  return anchor.artifactSha256 !== artifact.sha256;
}

/** MM:SS.mmm, or HH:MM:SS.mmm past an hour — matches the compiled brief exactly. */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const msPart = String(total % 1000).padStart(3, '0');
  const totalSec = Math.floor(total / 1000);
  const sec = String(totalSec % 60).padStart(2, '0');
  const totalMin = Math.floor(totalSec / 60);
  const min = String(totalMin % 60).padStart(2, '0');
  const hours = Math.floor(totalMin / 60);
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${min}:${sec}.${msPart}` : `${min}:${sec}.${msPart}`;
}

/** The one-line locator shown on an issue card. Mirrors the brief's phrasing. */
export function anchorLabel(anchor: ReviewAnchor | Record<string, unknown> | null | undefined): string {
  const a = anchor as Record<string, unknown> | null | undefined;
  if (!a) return '';
  if (a.type === 'media_time') {
    const start = formatMs(Number(a.timeStartMs) || 0);
    return a.timeEndMs === null || a.timeEndMs === undefined
      ? start
      : `${start} – ${formatMs(Number(a.timeEndMs) || 0)}`;
  }
  if (a.type === 'pdf_text') return `Page ${a.page}`;
  if (a.type === 'text_selection') return `Characters ${a.startOffset}–${a.endOffset}`;
  return 'Whole file';
}

/**
 * Deterministic issue order for the rail: media time, then PDF page, then text
 * offset, then creation. Whole-artifact comments come last. Same ordering the
 * backend compiles the brief in, so the rail and the brief never disagree.
 */
export function sortIssues<T extends { anchor?: Record<string, unknown>; createdAt?: string | null; id: string }>(issues: T[]): T[] {
  const key = (i: T): [number, number] => {
    const a = i.anchor || {};
    if (a.type === 'media_time') return [0, Number(a.timeStartMs) || 0];
    if (a.type === 'pdf_text') return [1, Number(a.page) || 0];
    if (a.type === 'text_selection') return [2, Number(a.startOffset) || 0];
    return [3, 0];
  };
  return [...issues].sort((x, y) => {
    const [xk, xv] = key(x); const [yk, yv] = key(y);
    if (xk !== yk) return xk - yk;
    if (xv !== yv) return xv - yv;
    const xt = String(x.createdAt || ''); const yt = String(y.createdAt || '');
    if (xt !== yt) return xt < yt ? -1 : 1;
    return x.id < y.id ? -1 : 1;
  });
}
