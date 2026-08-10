#!/usr/bin/env node
/**
 * Mutation test for the Wave 2 spatial-annotation surface.
 *
 * Every mutant below re-introduces one way an on-picture annotation silently lies:
 * about WHERE it points (coordinate space, letterbox, DPR, rounding, drag threshold),
 * WHEN it points there (frozen timestamp vs live playhead, pause-on-annotate), WHAT it
 * is (point vs rect), WHICH file it applies to (reference-target collapse, reopen
 * retargeting), or WHETHER its screenshot evidence is real (unverified acceptance,
 * capture-request deletion, submit-gate removal). If the suite still passes with the
 * mutant in place, the test claiming to prevent that regression is decorative and the
 * build fails.
 *
 * Boundaries covered (the Wave 2 load-bearing list, Dashboard side):
 *   coordinate-space   the space literal drifting off normalized_visual_content_v1
 *   letterbox          normalizing against the element instead of the content box
 *   dpr                devicePixelRatio applied to values already in CSS px
 *   bounds             a letterbox click clamped into the picture instead of refused
 *   rounding           float noise the backend's micro-unit digest disagrees with
 *   threshold          point/drag decided off the documented boundary
 *   point-rect         a rectangle saved as a point, or a point carrying a size
 *   timestamp-drift    the anchor reading the live playhead instead of the freeze
 *   pause              annotation starting without pausing playback
 *   retarget           reopen seeking elsewhere, or v2 staleness read off the v1 key
 *   reference          observe-A-change-B collapsing into change-A
 *   evidence           unverified frames unlocking Submit, or capture never requested
 *
 * Baseline discipline: the UNMUTATED tree must run green first (requireGreenBaseline —
 * import errors and skipped rendered tests are HARNESS BROKEN, never kills).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceBaseline, materializeTree, runSuites } from './mutation-harness-support.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const GEO = 'lib/review-spatial-geometry.ts';
const ANCHOR = 'lib/review-anchor.ts';
const FEEDBACK = 'lib/review-timestamp-feedback.ts';
const STATUS = 'lib/review-evidence-status.ts';
const STATE = 'lib/review-room-state.ts';
const OVERLAY = 'app/(dashboard)/_components/review-spatial-overlay.tsx';
const COMPONENT = 'app/(dashboard)/_components/review-room.tsx';

const files = [
  GEO, 'lib/review-spatial-geometry.test.ts',
  ANCHOR, 'lib/review-spatial-anchor.test.ts',
  FEEDBACK, 'lib/review-spatial-feedback.test.ts',
  STATUS,
  STATE,
  OVERLAY,
  COMPONENT,
  'lib/review-room-spatial.test.ts',
  'scripts/dom-test-loader.mjs', 'scripts/stubs/next-navigation.mjs',
];
const tests = [
  'lib/review-spatial-geometry.test.ts',
  'lib/review-spatial-anchor.test.ts',
  'lib/review-spatial-feedback.test.ts',
  // The rendered suite — the only one that can kill a mutation in the seam between
  // the overlay, the component wiring, and the transport.
  'lib/review-room-spatial.test.ts',
];

const mutations = [
  // ── coordinate space ──────────────────────────────────────────────────────
  ['coordinate-space', 'the space literal drifts — anchors claim a space the backend refuses', ANCHOR,
    "export const COORDINATE_SPACE = 'normalized_visual_content_v1' as const;",
    "export const COORDINATE_SPACE = 'element_px_v1' as const;"],

  // ── letterbox / pillarbox ─────────────────────────────────────────────────
  ['letterbox', 'the content box loses its centering offset', GEO,
    '    left: (elementWidth - width) / 2,',
    '    left: 0,'],
  ['letterbox', 'contain-fit scales by width alone — portrait sources drift', GEO,
    '  const scale = Math.min(elementWidth / naturalWidth, elementHeight / naturalHeight);',
    '  const scale = elementWidth / naturalWidth;'],

  // ── device pixel ratio ────────────────────────────────────────────────────
  ['dpr', 'devicePixelRatio is applied to coordinates already in CSS px', GEO,
    '  const x = args.clientX - args.elementRect.left - content.left;',
    '  const x = (args.clientX - args.elementRect.left) * (((globalThis as { devicePixelRatio?: number }).devicePixelRatio) || 1) - content.left;'],

  // ── bounds ────────────────────────────────────────────────────────────────
  ['bounds', 'a letterbox click is clamped into the picture instead of refused', GEO,
    '  if (x < 0 || y < 0 || x > content.width || y > content.height) return null;',
    '  if (false) return null;'],

  // ── micro-unit rounding ───────────────────────────────────────────────────
  ['rounding', 'raw float noise leaves the module — the backend digest disagrees', GEO,
    '  return {\n    x: roundNormalized(Math.min(1, Math.max(0, x / content.width))),\n    y: roundNormalized(Math.min(1, Math.max(0, y / content.height))),\n  };',
    '  return {\n    x: Math.min(1, Math.max(0, x / content.width)),\n    y: Math.min(1, Math.max(0, y / content.height)),\n  };'],

  // ── the drag threshold ────────────────────────────────────────────────────
  ['threshold', 'travel AT the documented threshold becomes a drag', GEO,
    '  return Math.abs(args.endClientX - args.startClientX) > DRAG_THRESHOLD_PX\n    || Math.abs(args.endClientY - args.startClientY) > DRAG_THRESHOLD_PX;',
    '  return Math.abs(args.endClientX - args.startClientX) >= DRAG_THRESHOLD_PX\n    || Math.abs(args.endClientY - args.startClientY) >= DRAG_THRESHOLD_PX;'],

  // ── point vs rect ─────────────────────────────────────────────────────────
  ['point-rect', 'a completed drag is saved as a point at the drag origin', OVERLAY,
    "          geometry: { kind: 'rect', x: rect.x, y: rect.y, width: rect.width, height: rect.height },",
    "          geometry: { kind: 'point', x: rect.x, y: rect.y, width: null, height: null },"],
  ['point-rect', 'a point anchor keeps a size a caller slipped in', ANCHOR,
    "      width: args.geometry.kind === 'point' ? null : args.geometry.width,",
    '      width: args.geometry.width,'],

  // ── timestamp drift ───────────────────────────────────────────────────────
  ['timestamp-drift', 'the saved anchor reads the live playhead instead of the freeze', COMPONENT,
    '    if (d.spatial) return spatialAnchorFromDraft(d);',
    '    if (d.spatial) return spatialAnchorFromDraft({ ...d, anchorMs: playheadMs });'],
  ['timestamp-drift', 'the overlay stops carrying the frozen timestamp for a point', OVERLAY,
    "        geometry: { kind: 'point', x: point.x, y: point.y, width: null, height: null },\n        sourceFrame,\n      },\n      frozenTimestampMs,",
    "        geometry: { kind: 'point', x: point.x, y: point.y, width: null, height: null },\n        sourceFrame,\n      },\n      frozenTimestampMs: null,"],
  ['timestamp-drift', 'reopening an issue loses its frozen time and takes nothing', FEEDBACK,
    '      anchorMs: temporal ? Math.max(0, Math.round(Number(temporal.startMs) || 0)) : null,',
    '      anchorMs: null,'],

  // ── pause on annotate ─────────────────────────────────────────────────────
  ['pause', 'starting an annotation no longer pauses the video', COMPONENT,
    '    el.pause();\n    const ms = Math.round(Math.max(0, el.currentTime) * 1000);',
    '    const ms = Math.round(Math.max(0, el.currentTime) * 1000);'],

  // ── retargeting ───────────────────────────────────────────────────────────
  ['retarget', 'opening a spatial issue seeks to zero instead of its frozen frame', STATE,
    '    ? (Number(temporal.startMs) || 0)',
    '    ? 0'],
  ['retarget', 'v2 staleness is measured against the v1 digest key', ANCHOR,
    "  const claimed = anchor?.version === 2 ? anchor?.observedArtifactSha256 : anchor?.artifactSha256;",
    '  const claimed = anchor?.artifactSha256;'],
  ['retarget', 'the frozen spatial geometry aliases the caller instead of copying', FEEDBACK,
    '      geometry: { ...args.spatial.geometry },',
    '      geometry: args.spatial.geometry,'],

  // ── reference mode ────────────────────────────────────────────────────────
  ['reference', 'observe-A-change-B collapses into change-A', FEEDBACK,
    '    intent: draft.referenceTarget\n      ? {\n        mode: INTENT_REFERENCE,\n        targetArtifactId: draft.referenceTarget.artifactId,\n        targetArtifactSha256: draft.referenceTarget.sha256,\n      }\n      : { mode: INTENT_CHANGE },',
    '    intent: { mode: INTENT_CHANGE },'],

  // ── evidence honesty ──────────────────────────────────────────────────────
  ['evidence', 'any evidence row — pending, failed, revoked — unlocks Submit', STATUS,
    '    if (ev?.ready === true) continue;',
    '    if (ev) continue;'],
  ['evidence', 'an unreadable status read stops blocking the send', STATUS,
    "  if (!status || (status.state !== 'ready')) {",
    '  if (false) {'],
  ['evidence', 'a saved spatial issue never requests its screenshot capture', COMPONENT,
    '      if (body.issue?.id && anchor && isSpatialAnchorV2(anchor)) void requestEvidence(body.issue.id);',
    ''],
  ['evidence', 'the submit button ignores the evidence gate', COMPONENT,
    "                  || (submitView.mode !== 'accept_result' && gate.blocked)",
    '                  || false'],

  // ── discoverability / native controls ─────────────────────────────────────
  ['controls', 'the overlay covers the native video transport', OVERLAY,
    "      style={{ bottom: mediaKind === 'video' ? CONTROLS_EXCLUSION_PX : 0, touchAction: 'none' }}",
    "      style={{ bottom: 0, touchAction: 'none' }}"],
];

const label = 'review-spatial-annotation';
announceBaseline({ label, root, files, dir: mkdtempSync(join(tmpdir(), 'implexa-spatial-baseline-')), suites: tests });

let killed = 0;
const survivors = [];
for (const [boundary, name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-spatial-mutant-'));
  try {
    materializeTree(root, files, dir);
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    // A drifted anchor is a mutation that never happened — reporting it killed would
    // be the exact lie this harness exists to catch.
    if (!source.includes(from)) throw new Error(`Mutation anchor missing: [${boundary}] ${name}`);
    writeFileSync(target, source.replace(from, to));
    const result = runSuites(root, dir, tests);
    if (result.status === 0) {
      survivors.push(`[${boundary}] ${name}`);
      console.log(`SURVIVED [${boundary}] ${name}`);
    } else {
      killed += 1;
      console.log(`KILLED [${boundary}] ${name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const boundaries = new Set(mutations.map(([b]) => b)).size;
console.log(`\nMutation result: ${killed}/${mutations.length} killed across ${boundaries} boundaries.`);
if (survivors.length) {
  console.error(`\n✖ ${survivors.length} mutation(s) survived — the tests naming them are decorative:`);
  for (const s of survivors) console.error(`   ${s}`);
  process.exit(1);
}
