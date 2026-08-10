/**
 * lib/review-spatial-geometry.ts — client coordinates ⇄ `normalized_visual_content_v1`.
 *
 * THE COORDINATE SPACE IS THE VISUAL CONTENT, NOT THE ELEMENT. Both the review players
 * render with `object-fit: contain`, so a 16:9 video inside a squarer element shows
 * letterbox bars, and a click in a bar is a click on NOTHING — normalizing against the
 * element's outer box would silently shift every annotation toward the bars' side.
 * Everything here therefore goes through the contain-fitted CONTENT RECT first, and a
 * position outside it is REJECTED (null), never clamped into the picture: a click on
 * the letterbox is not a claim about any pixel.
 *
 * UNITS ARE CSS PIXELS THROUGHOUT, on purpose. `getBoundingClientRect()` and mouse
 * `clientX/Y` are both reported in CSS pixels — the browser has already applied
 * devicePixelRatio to both sides of that comparison. There is deliberately NO dpr
 * parameter on any function here: accepting one and multiplying would double-apply it,
 * which shows up only on retina displays and only as a subtle 2× drift. Scrolling needs
 * no special handling for the same reason — client coordinates and the client rect
 * share the viewport origin.
 *
 * NORMALIZED VALUES ARE ROUNDED TO MICRO-UNITS (1e-6) before they leave this module.
 * The backend digests coordinates as `round(v * 1e6)` integers; emitting raw float
 * noise would make two visually identical anchors digest differently.
 *
 * Pure on purpose: letterbox math is exactly the kind of thing that silently breaks in
 * JSX, so every rule of it is executable in a test.
 */

export type ContentRect = { left: number; top: number; width: number; height: number };
export type NormalizedPoint = { x: number; y: number };
export type NormalizedRect = { x: number; y: number; width: number; height: number };

/**
 * How far a pointer may travel (CSS px, either axis) and still mean "a click".
 * Beyond it, the gesture is a drag and marks a rectangle. 6px absorbs the natural
 * wobble of a press on a trackpad or touchscreen without making small rectangles
 * unreachable.
 */
export const DRAG_THRESHOLD_PX = 6;

const COORD_SCALE = 1_000_000;

/** Micro-unit rounding — the exact precision the backend digest works in. */
export function roundNormalized(v: number): number {
  return Math.round(v * COORD_SCALE) / COORD_SCALE;
}

/**
 * Where the visual content actually sits inside an `object-fit: contain` element,
 * in the element's own coordinate space (CSS px from its top-left corner).
 *
 * Null when nothing can be located: a zero-sized element (display:none, mid-layout)
 * or media that has not reported its intrinsic size yet. Callers treat null as "no
 * annotation surface exists right now", never as a full-element fallback — that
 * fallback IS the letterbox bug.
 */
export function visualContentRect(args: {
  elementWidth: number;
  elementHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}): ContentRect | null {
  const { elementWidth, elementHeight, naturalWidth, naturalHeight } = args;
  if (!Number.isFinite(elementWidth) || !Number.isFinite(elementHeight)
    || elementWidth <= 0 || elementHeight <= 0) return null;
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)
    || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const scale = Math.min(elementWidth / naturalWidth, elementHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    left: (elementWidth - width) / 2,
    top: (elementHeight - height) / 2,
    width,
    height,
  };
}

/**
 * One client-space position → normalized visual-content coordinates, or null when it
 * lands outside the visible content (letterbox, pillarbox, or off the element).
 *
 * STRICT REJECTION, NOT CLAMPING, for a fresh position: the reviewer pointed at a
 * bar, and the honest response is "there is nothing here to mark".
 */
export function normalizedPointFromClient(args: {
  clientX: number;
  clientY: number;
  /** The media element's getBoundingClientRect() — CSS px, viewport origin. */
  elementRect: { left: number; top: number; width: number; height: number };
  naturalWidth: number;
  naturalHeight: number;
}): NormalizedPoint | null {
  const content = visualContentRect({
    elementWidth: args.elementRect.width,
    elementHeight: args.elementRect.height,
    naturalWidth: args.naturalWidth,
    naturalHeight: args.naturalHeight,
  });
  if (!content) return null;
  const x = args.clientX - args.elementRect.left - content.left;
  const y = args.clientY - args.elementRect.top - content.top;
  if (x < 0 || y < 0 || x > content.width || y > content.height) return null;
  return {
    x: roundNormalized(Math.min(1, Math.max(0, x / content.width))),
    y: roundNormalized(Math.min(1, Math.max(0, y / content.height))),
  };
}

/**
 * A drag → normalized rectangle. The START must be on visible content (same strict
 * rejection as a point — a drag that begins on the letterbox marks nothing). The END
 * is CLAMPED to the content box: a drag that runs off the edge means "to the edge",
 * which is the reviewer's visible intent, not a refusal case.
 *
 * Degenerate spans (zero width or height after clamping) return null — the backend
 * requires strictly positive rect dimensions, and a zero-area rectangle is a point
 * wearing a rectangle's shape.
 */
export function normalizedRectFromDrag(args: {
  startClientX: number;
  startClientY: number;
  endClientX: number;
  endClientY: number;
  elementRect: { left: number; top: number; width: number; height: number };
  naturalWidth: number;
  naturalHeight: number;
}): NormalizedRect | null {
  const content = visualContentRect({
    elementWidth: args.elementRect.width,
    elementHeight: args.elementRect.height,
    naturalWidth: args.naturalWidth,
    naturalHeight: args.naturalHeight,
  });
  if (!content) return null;
  const sx = args.startClientX - args.elementRect.left - content.left;
  const sy = args.startClientY - args.elementRect.top - content.top;
  if (sx < 0 || sy < 0 || sx > content.width || sy > content.height) return null;
  const ex = Math.min(content.width, Math.max(0, args.endClientX - args.elementRect.left - content.left));
  const ey = Math.min(content.height, Math.max(0, args.endClientY - args.elementRect.top - content.top));
  const left = Math.min(sx, ex);
  const top = Math.min(sy, ey);
  const width = Math.abs(ex - sx);
  const height = Math.abs(ey - sy);
  if (width <= 0 || height <= 0) return null;
  const x = roundNormalized(left / content.width);
  const y = roundNormalized(top / content.height);
  // Dimensions are rounded so that x+width can never exceed 1 by float noise — the
  // backend compares exact micro-units with no slack.
  const w = Math.min(roundNormalized(width / content.width), roundNormalized(1 - x));
  const h = Math.min(roundNormalized(height / content.height), roundNormalized(1 - y));
  if (w <= 0 || h <= 0) return null;
  return { x, y, width: w, height: h };
}

/** Point or drag? Measured in CSS px of pointer travel, either axis. */
export function isDragGesture(args: {
  startClientX: number; startClientY: number;
  endClientX: number; endClientY: number;
}): boolean {
  return Math.abs(args.endClientX - args.startClientX) > DRAG_THRESHOLD_PX
    || Math.abs(args.endClientY - args.startClientY) > DRAG_THRESHOLD_PX;
}

/**
 * Normalized geometry → percent-based CSS for an overlay positioned exactly over the
 * ELEMENT box. The content offset is folded in here, so pins and rectangles land on
 * the picture even when the element shows bars. Percentages (not px) so the overlay
 * survives responsive resizes between renders without recomputation.
 */
export function overlayStyleForGeometry(
  geometry: { kind: 'point' | 'rect'; x: number; y: number; width: number | null; height: number | null },
  args: { elementWidth: number; elementHeight: number; naturalWidth: number; naturalHeight: number },
): { leftPct: number; topPct: number; widthPct: number | null; heightPct: number | null } | null {
  const content = visualContentRect(args);
  if (!content) return null;
  const toLeftPct = (nx: number) => ((content.left + nx * content.width) / args.elementWidth) * 100;
  const toTopPct = (ny: number) => ((content.top + ny * content.height) / args.elementHeight) * 100;
  if (geometry.kind === 'point') {
    return { leftPct: toLeftPct(geometry.x), topPct: toTopPct(geometry.y), widthPct: null, heightPct: null };
  }
  const w = geometry.width ?? 0;
  const h = geometry.height ?? 0;
  return {
    leftPct: toLeftPct(geometry.x),
    topPct: toTopPct(geometry.y),
    widthPct: ((w * content.width) / args.elementWidth) * 100,
    heightPct: ((h * content.height) / args.elementHeight) * 100,
  };
}

/**
 * Nudge a normalized point by whole-percent steps — the keyboard alternative to a
 * pointer. Clamped to [0,1]: arrowing past an edge stops at the edge rather than
 * rejecting, because the point already exists and is being MOVED, not placed.
 */
export function nudgeNormalizedPoint(
  point: NormalizedPoint,
  direction: 'up' | 'down' | 'left' | 'right',
  stepPct = 1,
): NormalizedPoint {
  const step = stepPct / 100;
  const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
  const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
  return {
    x: roundNormalized(Math.min(1, Math.max(0, point.x + dx))),
    y: roundNormalized(Math.min(1, Math.max(0, point.y + dy))),
  };
}
