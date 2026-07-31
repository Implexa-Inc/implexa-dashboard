// node --test lib/review-preview.test.ts
//
// Local-file preview. Two rules dominate:
//
//   1. NO PATH EVER REACHES THE BROWSER. The packet carries none, the IPC takes only
//      ids, and every src is gated on an opaque implexa-artifact:// token URL.
//   2. "We could not open it" is NOT "the file is missing". A failed authorization
//      says nothing about whether the file exists, and telling a user their work is
//      gone when it isn't is the worst thing this surface could do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  previewKind, desktopPreviewSupported, inDesktopApp, decidePreview,
  interpretPreviewResult, isSafePreviewUrl,
} from './review-preview.ts';

const validated = (path: string) => ({ status: 'validated', relativePath: path });

test('the v0 allowlist maps only the promised types', () => {
  assert.equal(previewKind('out/final.mp4'), 'video');
  assert.equal(previewKind('voice.mp3'), 'audio');
  assert.equal(previewKind('a.wav'), 'audio');
  assert.equal(previewKind('thumb.PNG'), 'image');
  assert.equal(previewKind('README.md'), 'text');
  assert.equal(previewKind('data.csv'), 'text');
  assert.equal(previewKind('report.pdf'), 'pdf');
  // MOV is deliberately NOT promised even though Chromium sometimes decodes it.
  assert.equal(previewKind('clip.mov'), 'unsupported');
  assert.equal(previewKind('archive.zip'), 'unsupported');
  assert.equal(previewKind('noextension'), 'unsupported');
});

// ── legacy desktop feature detection ────────────────────────────────────────

test('REPRO: an old desktop build says "Update Implexa", not a broken player', () => {
  // In the app, but this build predates the preview bridge.
  const d = decidePreview({ artifact: validated('a.mp4'), inDesktop: true, bridgeSupported: false });
  assert.equal(d.state, 'update_required');
  assert.match(d.message, /Update Implexa to preview local files/i);
  assert.equal(d.offerOpenInDesktop, false, 'already in the app — sending them there again is nonsense');
});

test('an ordinary browser is told to open the desktop app, and is never handed a path', () => {
  const d = decidePreview({ artifact: validated('a.mp4'), inDesktop: false, bridgeSupported: false });
  assert.equal(d.state, 'desktop_required');
  assert.equal(d.offerOpenInDesktop, true);
  assert.doesNotMatch(d.message, /\/Users\/|\/home\/|file:/, 'no filesystem hint may leak into the copy');
});

test('feature detection reads the bridge FUNCTION, not merely the object', () => {
  // An old build can expose window.implexaDesktop with no preview method at all.
  assert.equal(desktopPreviewSupported({ implexaDesktop: {} }), false);
  assert.equal(inDesktopApp({ implexaDesktop: {} }), true, 'it IS the app, just an old one');
  assert.equal(desktopPreviewSupported({ implexaDesktop: { createArtifactPreview: () => {} } }), true);
  assert.equal(desktopPreviewSupported({}), false);
  assert.equal(inDesktopApp({}), false);
});

// ── unproven bytes ──────────────────────────────────────────────────────────

test('a declared or rejected artifact is refused even in a fully capable desktop', () => {
  for (const status of ['declared', 'rejected']) {
    const d = decidePreview({ artifact: { status, relativePath: 'a.mp4' }, inDesktop: true, bridgeSupported: true });
    assert.equal(d.state, 'not_validated', `${status} must not be previewed as evidence`);
  }
});

test('an unsupported type explains itself and offers an escape, never an empty player', () => {
  const d = decidePreview({ artifact: validated('clip.mov'), inDesktop: true, bridgeSupported: true });
  assert.equal(d.state, 'unsupported');
  assert.equal(d.offerExternal, true);
  assert.ok(d.message.length > 0);
});

// ── preview unavailable is NOT file missing ─────────────────────────────────

test('REPRO: a refused or failed preview never claims the file is missing', () => {
  for (const result of [null, undefined, { ok: false }, { ok: false, error: 'denied' }, {}]) {
    const d = interpretPreviewResult(result, 'video');
    assert.equal(d.state, 'unavailable');
    assert.match(d.message, /does not mean the file is gone/i);
    assert.doesNotMatch(d.message, /missing|deleted|not found/i,
      'we asked and got no answer; that says nothing about whether the file exists');
  }
});

test('a changed file is its own state, distinct from unavailable', () => {
  const d = interpretPreviewResult({ ok: false, state: 'changed_since_validation' }, 'video');
  assert.equal(d.state, 'changed_since_validation');
  assert.match(d.message, /changed on disk/i);
});

test('a ready preview only accepts an opaque protocol URL', () => {
  const ok = interpretPreviewResult({ ok: true, url: 'implexa-artifact://preview/abc123' }, 'video');
  assert.equal(ok.state, 'ready');

  // anything path-shaped is refused as ready
  for (const url of ['/Users/me/final.mp4', 'file:///Users/me/final.mp4', 'https://evil/x', '']) {
    const d = interpretPreviewResult({ ok: true, url }, 'video');
    assert.notEqual(d.state, 'ready', `${url} must not be treated as a preview URL`);
  }
});

test('isSafePreviewUrl rejects every path-bearing form', () => {
  assert.equal(isSafePreviewUrl('implexa-artifact://preview/opaque'), true);
  assert.equal(isSafePreviewUrl('file:///Users/me/a.mp4'), false);
  assert.equal(isSafePreviewUrl('/Users/me/a.mp4'), false);
  assert.equal(isSafePreviewUrl('implexa-artifact:///Users/me/a.mp4'), false);
  assert.equal(isSafePreviewUrl(null), false);
  assert.equal(isSafePreviewUrl(undefined), false);
});
