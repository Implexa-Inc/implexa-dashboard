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

// ── review_anchor.v2 — visual-spatial (Wave 2) ──────────────────────────────
// The EXACT shape of backend 0155's validator: eight top-level keys, no more, no
// fewer. The backend fails closed on any unknown or missing field, so this mirror
// builds the full literal shape rather than spreading options into it.
export const SPATIAL_ANCHOR_TYPE = 'visual_spatial' as const;
export const COORDINATE_SPACE = 'normalized_visual_content_v1' as const;
export const INTENT_CHANGE = 'change_observed_artifact' as const;
export const INTENT_REFERENCE = 'reference_for_artifact' as const;
export const MAX_TIME_MS = 86_400_000;
export const MAX_VISUAL_EDGE = 100_000;

export type SpatialGeometry = {
  kind: 'point' | 'rect';
  coordinateSpace: typeof COORDINATE_SPACE;
  x: number; y: number;
  width: number | null; height: number | null;
};
export type SpatialIntent =
  | { mode: typeof INTENT_CHANGE }
  | { mode: typeof INTENT_REFERENCE; targetArtifactId: string; targetArtifactSha256: string };
export type SpatialAnchorV2 = {
  version: 2;
  type: typeof SPATIAL_ANCHOR_TYPE;
  observedArtifactId: string;
  observedArtifactSha256: string;
  intent: SpatialIntent;
  temporal: { startMs: number; endMs: number | null } | null;
  geometry: SpatialGeometry;
  sourceFrame: { visualWidth: number; visualHeight: number };
};

export type ReviewAnchor = MediaAnchor | TextAnchor | PdfAnchor | ArtifactAnchor | SpatialAnchorV2;

export const QUOTE_MAX = 1000;
export const BODY_MAX = 4000;
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COORD_SCALE = 1_000_000;

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

/**
 * Build a v2 visual-spatial anchor in the backend's exact shape.
 *
 * The observed identity is the FROZEN draft target's — id and validated digest
 * captured when the annotation was placed, never the live selection. `temporal` is
 * null for a still image and `{startMs, endMs: null}` for a video frame; the caller
 * decides which by what it froze, not by sniffing the element.
 *
 * The UUID is lowercased here because the backend normalizes and compares lowercase;
 * emitting mixed case would make the client's copy of the anchor differ from the
 * durable row it round-trips back as.
 */
export function buildSpatialAnchor(args: {
  observedArtifactId: string;
  observedArtifactSha256: string;
  intent: SpatialIntent;
  temporalStartMs: number | null;
  geometry: { kind: 'point' | 'rect'; x: number; y: number; width: number | null; height: number | null };
  sourceFrame: { visualWidth: number; visualHeight: number };
}): SpatialAnchorV2 {
  const intent: SpatialIntent = args.intent.mode === INTENT_REFERENCE
    ? {
      mode: INTENT_REFERENCE,
      targetArtifactId: String(args.intent.targetArtifactId).toLowerCase(),
      targetArtifactSha256: args.intent.targetArtifactSha256,
    }
    : { mode: INTENT_CHANGE };
  return {
    version: 2,
    type: SPATIAL_ANCHOR_TYPE,
    observedArtifactId: String(args.observedArtifactId).toLowerCase(),
    observedArtifactSha256: args.observedArtifactSha256,
    intent,
    temporal: args.temporalStartMs === null
      ? null
      : { startMs: Math.max(0, Math.round(args.temporalStartMs)), endMs: null },
    geometry: {
      kind: args.geometry.kind,
      coordinateSpace: COORDINATE_SPACE,
      x: args.geometry.x,
      y: args.geometry.y,
      width: args.geometry.kind === 'point' ? null : args.geometry.width,
      height: args.geometry.kind === 'point' ? null : args.geometry.height,
    },
    sourceFrame: {
      visualWidth: Math.round(args.sourceFrame.visualWidth),
      visualHeight: Math.round(args.sourceFrame.visualHeight),
    },
  };
}

/** The version-2 discriminator, matching the backend's own predicate exactly. */
export function isSpatialAnchorV2(anchor: unknown): anchor is SpatialAnchorV2 {
  return !!anchor && typeof anchor === 'object' && !Array.isArray(anchor)
    && (anchor as SpatialAnchorV2).version === 2
    && (anchor as SpatialAnchorV2).type === SPATIAL_ANCHOR_TYPE;
}

const microUnits = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(v * COORD_SCALE);
};

/**
 * The v2 mirror of backend 0155's validator. Same rules, same fail-closed posture on
 * unknown/missing fields; the messages are the reviewer-facing rewording. If the two
 * ever disagree, the backend wins and the user sees its refusal.
 */
function spatialAnchorError(anchor: SpatialAnchorV2): string | null {
  const keys = Object.keys(anchor).sort();
  const expected = ['geometry', 'intent', 'observedArtifactId', 'observedArtifactSha256', 'sourceFrame', 'temporal', 'type', 'version'];
  if (keys.length !== expected.length || expected.some((k, i) => keys[i] !== k)) {
    return 'This annotation has a field the server does not implement.';
  }
  if (!UUID_RE.test(String(anchor.observedArtifactId || ''))) return 'This annotation is not bound to a file.';
  if (!SHA256_RE.test(String(anchor.observedArtifactSha256 || ''))) {
    return 'This artifact has no validated digest to anchor to.';
  }
  const intent = anchor.intent as Record<string, unknown> | null;
  if (!intent || typeof intent !== 'object') return 'This annotation does not say what it applies to.';
  if (intent.mode === INTENT_CHANGE) {
    if (Object.keys(intent).length !== 1) {
      return 'A change annotation must not carry a separate target file.';
    }
  } else if (intent.mode === INTENT_REFERENCE) {
    const ikeys = Object.keys(intent).sort();
    if (ikeys.join(',') !== 'mode,targetArtifactId,targetArtifactSha256') {
      return 'A reference annotation needs exactly its target file and digest.';
    }
    if (!UUID_RE.test(String(intent.targetArtifactId || ''))) return 'Pick the file this reference applies to.';
    if (!SHA256_RE.test(String(intent.targetArtifactSha256 || ''))) {
      return 'The target file has no validated digest.';
    }
    if (String(intent.targetArtifactId).toLowerCase() === String(anchor.observedArtifactId).toLowerCase()
      && intent.targetArtifactSha256 !== anchor.observedArtifactSha256) {
      return 'The target and observed file are the same file but carry different digests.';
    }
  } else {
    return 'This annotation does not say what it applies to.';
  }
  const t = anchor.temporal;
  if (t !== null) {
    if (!t || typeof t !== 'object') return 'The frozen timestamp is not valid.';
    const tkeys = Object.keys(t).sort();
    if (tkeys.join(',') !== 'endMs,startMs') return 'The frozen timestamp is not valid.';
    if (!Number.isInteger(t.startMs) || t.startMs < 0 || t.startMs > MAX_TIME_MS) {
      return 'The frozen timestamp is not a valid position.';
    }
    if (t.endMs !== null) {
      if (!Number.isInteger(t.endMs) || t.endMs < 0 || t.endMs > MAX_TIME_MS) {
        return 'The end time is not a valid position.';
      }
      if (t.endMs <= t.startMs) return 'The end of the range must come after the start.';
    }
  }
  const g = anchor.geometry;
  if (!g || typeof g !== 'object') return 'The annotation has no geometry.';
  const gkeys = Object.keys(g).sort();
  if (gkeys.join(',') !== 'coordinateSpace,height,kind,width,x,y') return 'The annotation geometry is malformed.';
  if (g.kind !== 'point' && g.kind !== 'rect') return 'The annotation must be a point or a rectangle.';
  if (g.coordinateSpace !== COORDINATE_SPACE) return 'The annotation uses an unsupported coordinate space.';
  const x = microUnits(g.x);
  const y = microUnits(g.y);
  if (x === null || y === null) return 'The annotation position is not a number.';
  if (x < 0 || x > COORD_SCALE || y < 0 || y > COORD_SCALE) {
    return 'The annotation lies outside the visible content.';
  }
  if (g.kind === 'point') {
    if (g.width !== null || g.height !== null) return 'A point annotation must not carry a size.';
  } else {
    const w = microUnits(g.width);
    const h = microUnits(g.height);
    if (w === null || h === null || w <= 0 || h <= 0) return 'Drag out a rectangle with a real area.';
    if (x + w > COORD_SCALE || y + h > COORD_SCALE) {
      return 'The rectangle runs off the visible content.';
    }
  }
  const sf = anchor.sourceFrame;
  if (!sf || typeof sf !== 'object') return 'The media dimensions were not captured.';
  const sfkeys = Object.keys(sf).sort();
  if (sfkeys.join(',') !== 'visualHeight,visualWidth') return 'The media dimensions were not captured.';
  if (!Number.isInteger(sf.visualWidth) || sf.visualWidth < 1 || sf.visualWidth > MAX_VISUAL_EDGE
    || !Number.isInteger(sf.visualHeight) || sf.visualHeight < 1 || sf.visualHeight > MAX_VISUAL_EDGE) {
    return 'The media dimensions were not captured.';
  }
  return null;
}

/** Same rules as the backend. Returns null when valid, else why not. */
export function anchorError(anchor: ReviewAnchor | null | undefined): string | null {
  if (!anchor || typeof anchor !== 'object') return 'An anchor is required.';
  if (anchor.version === 2) {
    if (anchor.type !== SPATIAL_ANCHOR_TYPE) return 'Unsupported anchor type.';
    return spatialAnchorError(anchor);
  }
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
  anchor: { artifactSha256?: string; observedArtifactSha256?: string; version?: number } | null | undefined,
  artifact: { sha256?: string | null; status?: string | null } | null | undefined,
): boolean {
  // A v2 anchor names the bytes it observed under its own key; the v1 key would read
  // as "no digest" and flag every current spatial comment stale.
  const claimed = anchor?.version === 2 ? anchor?.observedArtifactSha256 : anchor?.artifactSha256;
  if (!claimed || !artifact) return true;
  if (artifact.status !== 'validated') return true;
  return claimed !== artifact.sha256;
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

/** `(74%, 32%)` — how a normalized position is spoken about everywhere user-facing. */
export function spatialPercentLabel(geometry: { x: number; y: number }): string {
  return `(${Math.round(geometry.x * 100)}%, ${Math.round(geometry.y * 100)}%)`;
}

/** The one-line locator shown on an issue card. Mirrors the brief's phrasing. */
export function anchorLabel(anchor: ReviewAnchor | Record<string, unknown> | null | undefined): string {
  const a = anchor as Record<string, unknown> | null | undefined;
  if (!a) return '';
  if (isSpatialAnchorV2(a)) {
    const shape = a.geometry.kind === 'rect' ? 'Area' : 'Pin';
    const at = spatialPercentLabel(a.geometry);
    return a.temporal
      ? `${shape} ${formatMs(a.temporal.startMs)} ${at}`
      : `${shape} ${at}`;
  }
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
    // The backend's own grouping (anchorSortKey): a v2 anchor WITH a time sorts among
    // the temporal anchors; an image pin takes the fractional group after text so the
    // existing 0..3 groups — and the compiled order of reviews humans already approved
    // — never renumber.
    if (isSpatialAnchorV2(a)) {
      const t = a.temporal;
      return t ? [0, Number(t.startMs) || 0] : [2.5, 0];
    }
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
