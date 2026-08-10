// node --test lib/review-spatial-geometry.test.ts
//
// The client-coordinate → normalized_visual_content_v1 mapping, exhaustively.
//
// Every case here is one way a spatial annotation silently lands on the wrong pixels:
// normalizing against the element instead of the contain-fitted content (letterbox
// drift), applying devicePixelRatio to values the browser already reports in CSS px
// (retina 2× drift), clamping a letterbox click into the picture (inventing a
// location), or emitting float noise the backend's micro-unit digest disagrees with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAG_THRESHOLD_PX, isDragGesture, normalizedPointFromClient, normalizedRectFromDrag,
  nudgeNormalizedPoint, overlayStyleForGeometry, roundNormalized, visualContentRect,
} from './review-spatial-geometry.ts';

// A 16:9 video (1600×900) in a 4:3 element (800×600): contain scales to 800×450,
// letterboxed 75px top and bottom. The inverse (pillarbox) uses a 9:16 portrait
// source in the same element: 337.5×600, pillarboxed 231.25px left and right.
const LANDSCAPE = { elementWidth: 800, elementHeight: 600, naturalWidth: 1600, naturalHeight: 900 };
const PORTRAIT = { elementWidth: 800, elementHeight: 600, naturalWidth: 900, naturalHeight: 1600 };
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

// ── the content box ─────────────────────────────────────────────────────────

test('LETTERBOX: a wide source in a squarer element centers with top/bottom bars', () => {
  const c = visualContentRect(LANDSCAPE)!;
  assert.deepEqual(c, { left: 0, top: 75, width: 800, height: 450 });
});

test('PILLARBOX: a tall source centers with left/right bars', () => {
  const c = visualContentRect(PORTRAIT)!;
  assert.equal(c.top, 0);
  assert.equal(c.height, 600);
  assert.ok(Math.abs(c.width - 337.5) < 1e-9);
  assert.ok(Math.abs(c.left - 231.25) < 1e-9);
});

test('a degenerate element or unreported intrinsic size yields NO surface, never a full-element fallback', () => {
  assert.equal(visualContentRect({ ...LANDSCAPE, elementWidth: 0 }), null);
  assert.equal(visualContentRect({ ...LANDSCAPE, naturalWidth: 0 }), null);
  assert.equal(visualContentRect({ ...LANDSCAPE, naturalHeight: NaN }), null);
});

// ── points ──────────────────────────────────────────────────────────────────

test('the visual center normalizes to (0.5, 0.5) regardless of letterboxing', () => {
  // Element at viewport (10, 20). Content center: x=10+400, y=20+75+225.
  const p = normalizedPointFromClient({
    clientX: 410, clientY: 320, elementRect: rect(10, 20, 800, 600),
    naturalWidth: 1600, naturalHeight: 900,
  })!;
  assert.deepEqual(p, { x: 0.5, y: 0.5 });
});

test('REJECTION, NOT CLAMPING: a click on the letterbox bar maps to nothing', () => {
  // y=50 is inside the element (top 20) but above the content (top 95).
  const bar = normalizedPointFromClient({
    clientX: 410, clientY: 50, elementRect: rect(10, 20, 800, 600),
    naturalWidth: 1600, naturalHeight: 900,
  });
  assert.equal(bar, null, 'a letterbox click is not a claim about any pixel');
  // And past the right edge of a pillarboxed picture:
  const side = normalizedPointFromClient({
    clientX: 15, clientY: 300, elementRect: rect(10, 0, 800, 600),
    naturalWidth: 900, naturalHeight: 1600,
  });
  assert.equal(side, null);
});

test('RESIZE INVARIANCE: the same picture position normalizes identically at any rendered size', () => {
  // The same visual point — 25% across, 40% down the picture — at two element sizes.
  const small = normalizedPointFromClient({
    clientX: 0 + 0.25 * 400, clientY: 37.5 + 0.4 * 225,
    elementRect: rect(0, 0, 400, 300), naturalWidth: 1600, naturalHeight: 900,
  })!;
  const large = normalizedPointFromClient({
    clientX: 0 + 0.25 * 800, clientY: 75 + 0.4 * 450,
    elementRect: rect(0, 0, 800, 600), naturalWidth: 1600, naturalHeight: 900,
  })!;
  assert.deepEqual(small, large);
  assert.deepEqual(small, { x: 0.25, y: 0.4 });
});

test('SCROLL: client coordinates and the client rect share the viewport origin, so scrolling cancels out', () => {
  // The page scrolled 500px: the rect's top moved to -480, the pointer reports
  // viewport coordinates too. Same picture point, same answer.
  const scrolled = normalizedPointFromClient({
    clientX: 410, clientY: -480 + 75 + 225, elementRect: rect(10, -480, 800, 600),
    naturalWidth: 1600, naturalHeight: 900,
  })!;
  assert.deepEqual(scrolled, { x: 0.5, y: 0.5 });
});

test('DPR: there is no devicePixelRatio input, and a retina-looking global changes nothing', () => {
  const g = globalThis as { devicePixelRatio?: number };
  const before = g.devicePixelRatio;
  try {
    g.devicePixelRatio = 2;
    const p = normalizedPointFromClient({
      clientX: 410, clientY: 320, elementRect: rect(10, 20, 800, 600),
      naturalWidth: 1600, naturalHeight: 900,
    })!;
    // getBoundingClientRect and clientX are BOTH CSS px — the browser already applied
    // the ratio to both sides. Multiplying again is the 2×-drift bug this pins down.
    assert.deepEqual(p, { x: 0.5, y: 0.5 });
  } finally {
    if (before === undefined) delete g.devicePixelRatio; else g.devicePixelRatio = before;
  }
});

test('normalized values are micro-unit rounded, so the backend digest sees no float noise', () => {
  const p = normalizedPointFromClient({
    clientX: 271, clientY: 187, elementRect: rect(0, 0, 813, 611),
    naturalWidth: 1600, naturalHeight: 900,
  })!;
  assert.equal(p.x, roundNormalized(p.x));
  assert.equal(p.y, roundNormalized(p.y));
  assert.equal(Math.round(p.x * 1_000_000), p.x * 1_000_000);
});

// ── rectangles ──────────────────────────────────────────────────────────────

test('a drag normalizes against the content box and works in any direction', () => {
  const forward = normalizedRectFromDrag({
    startClientX: 410, startClientY: 320, endClientX: 490, endClientY: 380,
    elementRect: rect(10, 20, 800, 600), naturalWidth: 1600, naturalHeight: 900,
  })!;
  assert.equal(forward.x, 0.5);
  assert.equal(forward.y, 0.5);
  assert.equal(forward.width, 0.1);
  assert.ok(Math.abs(forward.height - 60 / 450) < 1e-6);
  // The same rectangle dragged from bottom-right to top-left is the SAME rectangle.
  const reverse = normalizedRectFromDrag({
    startClientX: 490, startClientY: 380, endClientX: 410, endClientY: 320,
    elementRect: rect(10, 20, 800, 600), naturalWidth: 1600, naturalHeight: 900,
  })!;
  assert.deepEqual(reverse, forward);
});

test('a drag that starts on the letterbox marks nothing; one that runs off the edge clamps to it', () => {
  const fromBar = normalizedRectFromDrag({
    startClientX: 410, startClientY: 40, endClientX: 490, endClientY: 380,
    elementRect: rect(10, 20, 800, 600), naturalWidth: 1600, naturalHeight: 900,
  });
  assert.equal(fromBar, null, 'the start is the aim; a bar start aims at nothing');

  const offEdge = normalizedRectFromDrag({
    startClientX: 700, startClientY: 300, endClientX: 2000, endClientY: 2000,
    elementRect: rect(0, 0, 800, 600), naturalWidth: 1600, naturalHeight: 900,
  })!;
  // Clamped to the content's right/bottom edge — "to the edge" is the visible intent.
  assert.ok(offEdge.x + offEdge.width <= 1);
  assert.ok(offEdge.y + offEdge.height <= 1);
  assert.ok(Math.abs(offEdge.x + offEdge.width - 1) < 1e-6);
});

test('x+width and y+height can never exceed 1 in exact micro-units — the backend compares with no slack', () => {
  // An awkward element size that produces repeating decimals everywhere. The content
  // box here is 813×~484 letterboxed inside 813×611 at viewport top 100.
  const r = normalizedRectFromDrag({
    startClientX: 3, startClientY: 170, endClientX: 812, endClientY: 645,
    elementRect: rect(0, 100, 813, 611), naturalWidth: 1231, naturalHeight: 733,
  })!;
  assert.ok(Math.round(r.x * 1e6) + Math.round(r.width * 1e6) <= 1_000_000);
  assert.ok(Math.round(r.y * 1e6) + Math.round(r.height * 1e6) <= 1_000_000);
});

test('a zero-area span is null — the backend requires strictly positive rect dimensions', () => {
  const r = normalizedRectFromDrag({
    startClientX: 410, startClientY: 320, endClientX: 410, endClientY: 380,
    elementRect: rect(10, 20, 800, 600), naturalWidth: 1600, naturalHeight: 900,
  });
  assert.equal(r, null);
});

// ── the drag threshold ──────────────────────────────────────────────────────

test('the documented threshold: travel AT the threshold is a point, beyond it a drag', () => {
  assert.equal(DRAG_THRESHOLD_PX, 6, 'the documented value the UI copy relies on');
  assert.equal(isDragGesture({ startClientX: 0, startClientY: 0, endClientX: 6, endClientY: 0 }), false);
  assert.equal(isDragGesture({ startClientX: 0, startClientY: 0, endClientX: 7, endClientY: 0 }), true);
  assert.equal(isDragGesture({ startClientX: 0, startClientY: 0, endClientX: 0, endClientY: -7 }), true);
});

// ── projection back onto the element ────────────────────────────────────────

test('projection folds the content offset back in, so a pin lands on the picture, not the bar', () => {
  const at = overlayStyleForGeometry(
    { kind: 'point', x: 0.5, y: 0, width: null, height: null },
    LANDSCAPE,
  )!;
  assert.equal(at.leftPct, 50);
  // y=0 is the TOP OF THE PICTURE — 75px into the 600px element, not the element top.
  assert.equal(at.topPct, (75 / 600) * 100);
});

test('rect projection scales dimensions through the content box', () => {
  const at = overlayStyleForGeometry(
    { kind: 'rect', x: 0.25, y: 0.5, width: 0.5, height: 0.2 },
    LANDSCAPE,
  )!;
  assert.equal(at.widthPct, 50); // 0.5 × 800 content px / 800 element px
  assert.equal(at.heightPct, (0.2 * 450 / 600) * 100);
});

// ── keyboard nudge ──────────────────────────────────────────────────────────

test('a nudge moves by whole percents and clamps at the edges instead of rejecting', () => {
  assert.deepEqual(nudgeNormalizedPoint({ x: 0.5, y: 0.5 }, 'right'), { x: 0.51, y: 0.5 });
  assert.deepEqual(nudgeNormalizedPoint({ x: 0.5, y: 0.5 }, 'up', 10), { x: 0.5, y: 0.4 });
  assert.deepEqual(nudgeNormalizedPoint({ x: 0.995, y: 0 }, 'right'), { x: 1, y: 0 });
  assert.deepEqual(nudgeNormalizedPoint({ x: 0, y: 0.004 }, 'up'), { x: 0, y: 0 });
});
