// node --test "app/(dashboard)/review/review-recorder-pages.test.ts"
//
// The New review page and the recording player, as SOURCE (the ids-only boundary) and
// as RENDERED components against a fake contract-'1' Desktop bridge.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from '../../../lib/test/render.ts';
import { RECORD_NOTICE, MOMENTS_NEXT_NOTE, REASON_MESSAGES, emptyCard } from '../../../lib/review-recorder.ts';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const codeOnly = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PAGES = {
  'new/page.tsx': read('./new/page.tsx'),
  'new/new-review.tsx': read('./new/new-review.tsx'),
  'recordings/[recordingId]/page.tsx': read('./recordings/[recordingId]/page.tsx'),
  'recordings/[recordingId]/recording-player.tsx': read('./recordings/[recordingId]/recording-player.tsx'),
};
const LIB = read('../../../lib/review-recorder.ts');

// ── source guards ───────────────────────────────────────────────────────────

test('the pages never touch the bridge directly — only through the typed client', () => {
  for (const [name, source] of Object.entries(PAGES)) {
    const code = codeOnly(source);
    assert.doesNotMatch(code, /implexaDesktop/, `${name} reaches window.implexaDesktop`);
    assert.doesNotMatch(code, /reviewRecorder\s*\(/, `${name} calls the bridge itself`);
    assert.doesNotMatch(code, /onReviewRecorderChanged/, `${name} subscribes outside the client`);
  }
});

test('the pages never construct a file path', () => {
  for (const [name, source] of Object.entries(PAGES)) {
    const code = codeOnly(source);
    for (const forbidden of [
      /file:\/\//, /\/Users\//, /\/var\/folders/, /\/tmp\//, /node:path/, /\bpath\.join\b/, /\bfilePath\b/, /\bfilename\b/i,
      /\.(mp4|mov|m4v|webm)['"`]/, /implexa-artifact:/, /\blocalPath\b/, /\bpacketPath\b/,
    ]) assert.doesNotMatch(code, forbidden, `${name} must not contain ${forbidden}`);
  }
});

test('the client sends only ids, the microphone flag and moments across the bridge', () => {
  const code = codeOnly(LIB);
  const sent = [...code.matchAll(/call\('([a-zA-Z]+)'(?:, (\{[^}]*\}))?\)/g)].map((m) => [m[1], m[2] ?? null]);
  assert.deepEqual(sent, [
    ['start', '{ microphone }'],
    ['status', null],
    ['list', null],
    ['get', '{ recordingId }'],
    ['preview', '{ recordingId }'],
    ['saveMoments', '{ recordingId, moments }'],
    ['import', null],
    ['recover', '{ recordingId }'],
    ['delete', '{ recordingId }'],
  ]);
  // Every id-taking operation is guarded before the call.
  for (const op of ['get', 'preview', 'saveMoments', 'recover', 'remove']) {
    assert.match(code, new RegExp(`async ${op}\\(recordingId: string[^)]*\\) \\{\\n\\s+assertRecordingId\\(recordingId\\);`), `${op} is unguarded`);
  }
});

test('the preview token is revoked through the Review Room helper, not a second one', () => {
  const player = PAGES['recordings/[recordingId]/recording-player.tsx'];
  assert.match(player, /import \{ revokePreview \} from '@\/lib\/review-preview';/);
  assert.match(player, /return \(\) => \{ live = false; setPreview\(null\); if \(token\) void revokePreview\(token\); \};/);
  assert.match(player, /if \(!live\) \{ void revokePreview\(p\.token\); return; \}/, 'a token minted after unmount is revoked too');
});

test('the Work review list links to New review', () => {
  assert.match(read('../work/_components/ready-for-review-list.tsx'), /<Link href="\/review\/new"[^>]*>New review<\/Link>/);
});

// ── rendered ────────────────────────────────────────────────────────────────

const ID = 'rec_0001';
const NOW = '2026-10-25T12:00:00.000Z';
const TOKEN = 'abcdefghijklmnop0123456789';
const summary = (over: Record<string, unknown> = {}) => ({
  recordingId: ID, title: 'Checkout flow', origin: 'recorded', state: 'ready', failureReason: null,
  createdAt: NOW, durationMs: 65_000, sizeBytes: 12_000_000, width: 1920, height: 1080,
  hasMicrophone: true, hasPointerTrack: false, momentCount: 0, ...over,
});

type Call = { operation: string; args: unknown };
/** Args arrive from the jsdom realm; compare them as plain data. */
const plain = (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function bridge(reply: (op: string, args: unknown) => unknown, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const revoked: string[] = [];
  return {
    calls, revoked,
    value: {
      reviewRecorderContractVersion: '1',
      reviewRecorder: async (operation: string, args?: unknown) => { calls.push({ operation, args: plain(args) }); return reply(operation, args); },
      onReviewRecorderChanged: () => () => {},
      revokeArtifactPreview: async (token: string) => { revoked.push(token); return { ok: true }; },
      ...extra,
    },
  };
}
const library = { usedBytes: 2_000_000_000, limitBytes: 10_000_000_000 };

test('New review without the Desktop: the result path works, recording says why it cannot', async () => {
  const page = await render('../review/new/new-review.tsx', {});
  try {
    assert.match(page.text(), new RegExp(REASON_MESSAGES.desktop_required.slice(0, 40)));
    assert.ok(page.document.querySelector('a[href="/work?view=review"]'), 'Review a result still links to the queue');
    const record = [...page.document.querySelectorAll('button')].find((b) => b.textContent === 'Record')!;
    assert.equal(record.hasAttribute('disabled'), true);
    assert.match(page.text(), new RegExp(RECORD_NOTICE.slice(0, 50)), 'the notice sits under Record');
  } finally { page.cleanup(); }
});

test('New review with an older recorder contract asks for an update', async () => {
  const b = bridge(() => ({ ok: true }), { reviewRecorderContractVersion: '0' });
  const page = await render('../review/new/new-review.tsx', {}, { bridge: b.value });
  try {
    assert.match(page.text(), /Update Implexa Desktop/);
    assert.equal(b.calls.length, 0, 'an unknown contract is never called');
  } finally { page.cleanup(); }
});

test('New review lists the library and starts a recording with the microphone choice', async () => {
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, recordings: [summary(), summary({ recordingId: 'rec_0002', state: 'interrupted', durationMs: null, title: 'Half' })], library };
    if (op === 'status') return { ok: true, active: null };
    if (op === 'start') return { ok: true, recordingId: 'rec_0003' };
    return { ok: true };
  });
  const page = await render('../review/new/new-review.tsx', {}, { bridge: b.value });
  try {
    await page.act(() => {});
    assert.match(page.text(), /Checkout flow/);
    assert.match(page.text(), /2\.0 GB of 10 GB used/);
    assert.ok(page.document.querySelector(`a[href="/review/recordings/${ID}"]`), 'a ready recording opens in the player');
    assert.ok([...page.document.querySelectorAll('button')].some((x) => x.textContent === 'Recover'), 'interrupted offers Recover');

    const mic = page.document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.equal(mic.checked, true, 'microphone defaults ON');
    await page.click(mic);
    await page.click([...page.document.querySelectorAll('button')].find((x) => x.textContent === 'Record')!);
    assert.deepEqual(b.calls.find((c) => c.operation === 'start')?.args, { microphone: false });
  } finally { page.cleanup(); }
});

test('a cancelled upload is silent; a refusal is shown in plain English', async () => {
  let reason = 'selection_cancelled';
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, recordings: [], library };
    if (op === 'status') return { ok: true, active: null };
    if (op === 'import') return { ok: false, reason };
    return { ok: true };
  });
  const page = await render('../review/new/new-review.tsx', {}, { bridge: b.value });
  try {
    await page.act(() => {});
    const upload = () => [...page.document.querySelectorAll('button')].find((x) => x.textContent === 'Choose a video')!;
    await page.click(upload());
    assert.equal(page.document.querySelector('[role="alert"]'), null);
    reason = 'media_tools_unavailable';
    await page.click(upload());
    assert.equal(page.document.querySelector('[role="alert"]')?.textContent, REASON_MESSAGES.media_tools_unavailable);
    assert.deepEqual(page.calls.push, []);
  } finally { page.cleanup(); }
});

test('a malformed library answer fails closed instead of rendering rows', async () => {
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, recordings: [{ ...summary(), path: '/Users/me/rec.mp4' }], library };
    if (op === 'status') return { ok: true, active: null };
    return { ok: true };
  });
  const page = await render('../review/new/new-review.tsx', {}, { bridge: b.value });
  try {
    await page.act(() => {});
    assert.doesNotMatch(page.text(), /Checkout flow/);
    assert.match(page.text(), /could not verify/);
  } finally { page.cleanup(); }
});

test('the player loads a ready recording, previews it, saves moments, and revokes on unmount', async () => {
  const saved = [{
    momentId: '11111111-1111-4111-8111-111111111111', startMs: 1_000, endMs: 4_000, region: null,
    card: { ...emptyCard(), whatToDo: 'Use the brand colour' }, createdAt: NOW,
  }];
  const b = bridge((op, args) => {
    if (op === 'get') return { ok: true, recording: { ...summary({ momentCount: 1 }), pointerTrack: null, moments: saved } };
    if (op === 'preview') return { ok: true, url: `implexa-artifact://preview/${TOKEN}`, mime: 'video/mp4', token: TOKEN };
    if (op === 'saveMoments') return { ok: true, moments: (args as { moments: unknown }).moments };
    return { ok: true };
  });
  const page = await render('../review/recordings/[recordingId]/recording-player.tsx', { recordingId: ID }, { bridge: b.value });
  let cleaned = false;
  try {
    await page.act(() => {});
    const video = page.document.querySelector('video')!;
    assert.equal(video.getAttribute('src'), `implexa-artifact://preview/${TOKEN}`);
    assert.match(page.text(), new RegExp(MOMENTS_NEXT_NOTE));
    const what = page.document.querySelector('textarea') as HTMLTextAreaElement;
    assert.equal(what.value, 'Use the brand colour');
    assert.match(page.text(), /20\/600/);
    const save = () => [...page.document.querySelectorAll('button')].find((x) => /Save moments|Saved/.test(x.textContent || ''))!;
    assert.equal(save().hasAttribute('disabled'), true, 'nothing to save yet');

    // Delete the moment → dirty → Save sends the (now empty) list.
    await page.click([...page.document.querySelectorAll('button')].find((x) => x.textContent === 'Delete')!);
    assert.equal(save().hasAttribute('disabled'), false);
    await page.click(save());
    assert.deepEqual(b.calls.find((c) => c.operation === 'saveMoments')?.args, { recordingId: ID, moments: [] });
    assert.match(page.text(), /Moments saved on this Mac/);
    assert.deepEqual(b.calls.map((c) => c.operation), ['get', 'preview', 'saveMoments']);
  } finally {
    page.cleanup(); cleaned = true;
  }
  assert.ok(cleaned);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(b.revoked, [TOKEN], 'the preview token is revoked when the player unmounts');
});

test('the player guards unsaved moments with a modal on in-app navigation', async () => {
  const b = bridge((op) => {
    if (op === 'get') return { ok: true, recording: { ...summary(), pointerTrack: null, moments: [] } };
    if (op === 'preview') return { ok: true, url: `implexa-artifact://preview/${TOKEN}`, mime: 'video/mp4', token: TOKEN };
    return { ok: true };
  });
  const page = await render('../review/recordings/[recordingId]/recording-player.tsx', { recordingId: ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    // Mark with the keyboard: M at 0 s, M again (the jsdom video stays at 0, a 0 ms moment).
    await page.act(() => { page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'm' })); });
    await page.act(() => { page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'm' })); });
    assert.equal(page.document.querySelectorAll('textarea').length, 5, 'one moment with five card fields');

    await page.click(page.document.querySelector('a[href="/review/new"]')!);
    assert.ok(page.document.querySelector('[role="dialog"]'), 'leaving with unsaved moments asks first');
    assert.deepEqual(page.calls.push, []);
    await page.click([...page.document.querySelectorAll('button')].find((x) => x.textContent === 'Leave without saving')!);
    assert.deepEqual(page.calls.push, ['/review/new']);
  } finally { page.cleanup(); }
});

test('the player offers Recover for an interrupted recording and never asks for a preview', async () => {
  const b = bridge((op) => {
    if (op === 'get') return { ok: true, recording: { ...summary({ state: 'interrupted', durationMs: null }), pointerTrack: null, moments: [] } };
    return { ok: true };
  });
  const page = await render('../review/recordings/[recordingId]/recording-player.tsx', { recordingId: ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    await page.click([...page.document.querySelectorAll('button')].find((x) => x.textContent === 'Recover')!);
    assert.deepEqual(b.calls.map((c) => c.operation), ['get', 'recover', 'get']);
    assert.deepEqual(b.calls[1].args, { recordingId: ID });
  } finally { page.cleanup(); }
});
