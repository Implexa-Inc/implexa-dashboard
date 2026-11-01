// node --test "app/(dashboard)/review/review-recorder-pages.test.ts"
//
// The New review page and the recording player, as SOURCE (the ids-only boundary) and
// as RENDERED components against a fake contract-'1' Desktop bridge.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from '../../../lib/test/render.ts';
import { FAILURE_REASON_MESSAGES, RECORD_NOTICE, MOMENTS_NEXT_NOTE, REASON_MESSAGES, emptyCard } from '../../../lib/review-recorder.ts';

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
  assert.match(player, /import \{ inDesktopApp, revokePreview \} from '@\/lib\/review-preview';/);
  assert.match(player, /return \(\) => \{ live = false; setPreview\(null\); if \(token\) void revokePreview\(token\); \};/);
  assert.match(player, /if \(!live\) \{ void revokePreview\(p\.token\); return; \}/, 'a token minted after unmount is revoked too');
});

test('inside Implexa Desktop the player never registers beforeunload (Electron would silently block quit)', () => {
  const player = codeOnly(PAGES['recordings/[recordingId]/recording-player.tsx']);
  assert.match(player, /const guardUnload = !inDesktopApp\(\);/);
  assert.match(player, /if \(guardUnload\) window\.addEventListener\('beforeunload', onBeforeUnload\);/);
  assert.equal(player.match(/addEventListener\('beforeunload'/g)?.length, 1);
});

test('region drawing reuses the Review Room overlay instead of a second gesture implementation', () => {
  const player = codeOnly(PAGES['recordings/[recordingId]/recording-player.tsx']);
  assert.match(player, /import ReviewSpatialOverlay from '\.\.\/\.\.\/\.\.\/_components\/review-spatial-overlay';/);
  assert.match(player, /<ReviewSpatialOverlay\s+mediaKind="video"/);
  assert.doesNotMatch(player, /normalizedRectFromDrag|setPointerCapture\?\.\(e\.pointerId\);\s*drawStart/, 'no hand-rolled region drag');
});

test('one error-message helper, shared from the lib', () => {
  for (const [name, source] of Object.entries(PAGES)) {
    assert.doesNotMatch(codeOnly(source), /function errorMessage/, `${name} keeps its own copy`);
  }
});

test('the Work review list links to New review', () => {
  assert.match(read('../work/_components/ready-for-review-list.tsx'), /<Link href="\/review\/new"[^>]*>New review<\/Link>/);
});

// ── rendered ────────────────────────────────────────────────────────────────

const ID = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';
const OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const NEW = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const M1 = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-25T12:00:00.000Z';
const TOKEN = 'abcdefghijklmnop0123456789';
const summary = (over: Record<string, unknown> = {}) => ({
  recordingId: ID, title: 'Checkout flow', origin: 'recorded', state: 'ready', failureReason: null,
  createdAt: NOW, durationMs: 65_000, sizeBytes: 12_000_000, width: 1920, height: 1080,
  hasMicrophone: true, hasPointerTrack: false, momentCount: 0, ...over,
});
const detail = (over: Record<string, unknown> = {}, moments: unknown[] = []) =>
  ({ ...summary({ momentCount: moments.length, ...over }), pointerTrack: null, moments });
const previewOk = { ok: true, url: `implexa-artifact://preview/${TOKEN}`, mime: 'video/mp4', token: TOKEN };
const library = { usedBytes: 2 * 1024 ** 3, limitBytes: 10 * 1024 ** 3 };

type Call = { operation: string; args: unknown };
/** Args arrive from the jsdom realm; compare them as plain data. */
const plain = (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function bridge(reply: (op: string, args: unknown) => unknown, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const revoked: string[] = [];
  const listeners: Array<(e: unknown) => void> = [];
  return {
    calls, revoked,
    emit: (e: unknown) => listeners.forEach((l) => l(e)),
    value: {
      reviewRecorderContractVersion: '2',
      reviewRecorder: async (operation: string, args?: unknown) => { calls.push({ operation, args: plain(args) }); return reply(operation, args); },
      onReviewRecorderChanged: (cb: (e: unknown) => void) => { listeners.push(cb); return () => { listeners.splice(listeners.indexOf(cb), 1); }; },
      revokeArtifactPreview: async (token: string) => { revoked.push(token); return { ok: true }; },
      ...extra,
    },
  };
}
function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const buttons = (page: Rendered) => [...page.document.querySelectorAll('button')];
const button = (page: Rendered, text: string | RegExp) =>
  buttons(page).find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent || '')));
const ops = (b: { calls: Call[] }) => b.calls.map((c) => c.operation);
type Rendered = Awaited<ReturnType<typeof render>>;

/** Type into a React-controlled textarea the way a user does. */
async function typeInto(page: Rendered, el: HTMLTextAreaElement, value: string) {
  await page.act(() => {
    const setter = Object.getOwnPropertyDescriptor(page.window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  });
}
async function key(page: Rendered, target: EventTarget, k: string) {
  await page.act(() => { target.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: k, bubbles: true })); });
}
const NEW_REVIEW = '../review/new/new-review.tsx';
const PLAYER = '../review/recordings/[recordingId]/recording-player.tsx';

test('New review without the Desktop: the result path works, recording says why it cannot', async () => {
  const page = await render(NEW_REVIEW, {ownerId:ID});
  try {
    assert.match(page.text(), new RegExp(REASON_MESSAGES.desktop_required.slice(0, 40)));
    assert.ok(page.document.querySelector('a[href="/work?view=review"]'), 'Review a result still links to the queue');
    assert.equal(button(page, 'Record')!.hasAttribute('disabled'), true);
    assert.match(page.text(), new RegExp(RECORD_NOTICE.slice(0, 50)), 'the notice sits under Record');
  } finally { page.cleanup(); }
});

test('New review with an older recorder contract asks for an update', async () => {
  const b = bridge(() => ({ ok: true }), { reviewRecorderContractVersion: '0' });
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    assert.match(page.text(), /Update Implexa Desktop/);
    assert.equal(b.calls.length, 0, 'an unknown contract is never called');
  } finally { page.cleanup(); }
});

test('New review lists the library, explains failures in plain English, and starts with the mic choice', async () => {
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, library, recordings: [
      summary(),
      summary({ recordingId: OTHER, state: 'interrupted', durationMs: null, title: 'Half' }),
      summary({ recordingId: NEW, state: 'failed', failureReason: 'empty_capture', durationMs: null, title: 'Empty' }),
    ] };
    if (op === 'status') return { ok: true, active: null };
    if (op === 'start') return { ok: true, recordingId: '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f' };
    return { ok: true };
  });
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => {});
    assert.match(page.text(), /Checkout flow/);
    assert.match(page.text(), /2\.0 GB of 10 GB used/);
    assert.ok(page.document.querySelector(`a[href="/review/recordings/${ID}"]`), 'a ready recording opens in the player');
    assert.ok(button(page, 'Recover'), 'interrupted offers Recover');
    assert.ok(button(page, 'Try again'), 'a failed recording offers Try again');
    assert.match(page.text(), new RegExp(FAILURE_REASON_MESSAGES.empty_capture));
    assert.doesNotMatch(page.text(), /empty_capture/, 'never the raw code');

    const mic = page.document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.equal(mic.checked, true, 'microphone defaults ON');
    await page.click(mic);
    await page.click(button(page, 'Record')!);
    assert.deepEqual(b.calls.find((c) => c.operation === 'start')?.args, { microphone: false,expectedOwnerId:ID });
  } finally { page.cleanup(); }
});

test('first-use screen permission is explained before choosing and never starts capture on its own', async () => {
  const b = bridge((op) => op === 'list' ? {ok:true,recordings:[],library}
    : op === 'start' ? {ok:true,recordingId:NEW} : {ok:true,active:{recordingId:NEW,state:'permission_required'}});
  const page = await render(NEW_REVIEW,{ownerId:ID},{bridge:b.value});
  try {
    await page.act(()=>{});
    assert.match(page.text(),/Finish screen recording setup/);
    assert.match(page.text(),/No recording has started/);
    assert.doesNotMatch(page.text(),/Choose a screen or window in the recorder window/);
    assert.equal(ops(b).includes('start'),false);
    const reopen = button(page,'Open permission setup')!;
    assert.equal(reopen.disabled,false);
    await page.click(reopen);
    assert.equal(ops(b).filter(op=>op==='start').length,1,'only the explicit reopen click sends start');
  } finally {page.cleanup();}
});

test('a failed capture opens a diagnostic modal after cleanup without retrying', async () => {
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, recordings: [], library };
    if (op === 'status') return { ok: true, active: null };
    return { ok: true };
  });
  const page = await render(NEW_REVIEW, { ownerId: ID }, { bridge: b.value });
  const event = { ownerId: ID, recordingId: NEW, state: 'start_failed',
    failure: { phase: 'display', errorName: 'NotAllowedError', reason: 'source_missing' } };
  try {
    await page.act(() => {});
    await page.act(() => b.emit({ ...event, ownerId: OTHER }));
    assert.equal(page.document.querySelector('[role="dialog"]'), null);
    await page.act(() => b.emit({ ...event, failure: { ...event.failure, message: 'PRIVATE' } }));
    assert.equal(page.document.querySelector('[role="dialog"]'), null);
    await page.act(() => b.emit(event));
    const modal = page.document.querySelector('[role="dialog"]');
    assert.ok(modal);
    assert.match(modal.textContent!, /selected screen or window disappeared/);
    assert.match(modal.textContent!, /No recording was saved/);
    assert.match(modal.textContent!, /NotAllowedError/);
    assert.doesNotMatch(page.text(), /PRIVATE/);
    assert.equal(ops(b).includes('start'), false, 'failure notification never launches a retry');
    await page.click(modal.querySelector('button[aria-label="Close"]')!);
    assert.equal(page.document.querySelector('[role="dialog"]'), null);
    assert.ok(button(page, 'Record'), 'the user can deliberately start another recording');
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
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => {});
    await page.click(button(page, 'Choose a video')!);
    assert.equal(page.document.querySelector('[role="alert"]'), null);
    reason = 'media_tools_unavailable';
    await page.click(button(page, 'Choose a video')!);
    assert.equal(page.document.querySelector('[role="alert"]')?.textContent, REASON_MESSAGES.media_tools_unavailable);
    assert.deepEqual(page.calls.push, []);
  } finally { page.cleanup(); }
});

test('a malformed library row is dropped and counted; the rest still render', async () => {
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, library, recordings: [{ ...summary({ recordingId: OTHER, title: 'Bad row' }), path: '/Users/me/rec.mp4' }, summary()] };
    if (op === 'status') return { ok: true, active: null };
    return { ok: true };
  });
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => {});
    assert.match(page.text(), /Checkout flow/);
    assert.doesNotMatch(page.text(), /Bad row/);
    assert.match(page.text(), /1 recording could not be read/);
  } finally { page.cleanup(); }
});

test('a malformed library envelope still fails closed', async () => {
  const b = bridge((op) => (op === 'list' ? { ok: true, recordings: [summary()] } : { ok: true, active: null }));
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => {});
    assert.doesNotMatch(page.text(), /Checkout flow/);
    assert.match(page.text(), /could not verify/);
  } finally { page.cleanup(); }
});

test('Delete: a cancelled native confirm is silent; a confirmed delete refreshes the library', async () => {
  let rows = [summary()];
  let confirm = false;
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, recordings: rows, library };
    if (op === 'status') return { ok: true, active: null };
    if (op === 'delete') { if (!confirm) return { ok: false, reason: 'delete_cancelled' }; rows = []; return { ok: true }; }
    return { ok: true };
  });
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => {});
    await page.click(button(page, 'Delete')!);
    assert.equal(page.document.querySelector('[role="alert"]'), null, 'cancel is not an error');
    assert.match(page.text(), /Checkout flow/);
    confirm = true;
    const listsBefore = ops(b).filter((o) => o === 'list').length;
    await page.click(button(page, 'Delete')!);
    assert.ok(ops(b).filter((o) => o === 'list').length > listsBefore, 'refreshed after delete');
    assert.doesNotMatch(page.text(), /Checkout flow/);
    assert.deepEqual(b.calls.filter((c) => c.operation === 'delete').map((c) => c.args), [{ recordingId: ID,expectedOwnerId:ID }, { recordingId: ID,expectedOwnerId:ID }]);
  } finally { page.cleanup(); }
});

test('Recover on an interrupted row calls recover with its id and refreshes', async () => {
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, recordings: [summary({ state: 'interrupted', durationMs: null })], library };
    if (op === 'status') return { ok: true, active: null };
    return { ok: true };
  });
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => {});
    await page.click(button(page, 'Recover')!);
    assert.deepEqual(b.calls.find((c) => c.operation === 'recover')?.args, { recordingId: ID,expectedOwnerId:ID });
    assert.equal(ops(b).at(-1), 'status', 'a list + status refresh followed');
  } finally { page.cleanup(); }
});

test('a long import shows a placeholder row and locks nothing else', async () => {
  const held = deferred();
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, recordings: [summary()], library };
    if (op === 'status') return { ok: true, active: null };
    if (op === 'import') return held.promise;
    return { ok: true };
  });
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => {});
    await page.click(button(page, 'Choose a video')!);
    assert.ok(page.document.querySelector('[data-testid="import-placeholder"]'));
    assert.match(page.text(), /Adding video…/);
    assert.equal(button(page, 'Record')!.hasAttribute('disabled'), false, 'Record stays available');
    assert.equal(button(page, 'Delete')!.hasAttribute('disabled'), false, 'other rows stay available');
    assert.equal(button(page, 'Adding…')!.hasAttribute('disabled'), true, 'only Upload waits');
    await page.act(async () => { held.resolve({ ok: true, recordingId: NEW }); });
    assert.deepEqual(page.calls.push, [`/review/recordings/${NEW}`]);
  } finally { page.cleanup(); }
});

test('a recording started here opens in the player once the Desktop says it is ready', async () => {
  let started = false;
  let ready = false;
  const b = bridge((op) => {
    if (op === 'list') return { ok: true, library, recordings: started ? [summary({ recordingId: NEW, state: ready ? 'ready' : 'finalizing', durationMs: ready ? 4_000 : null })] : [] };
    if (op === 'status') return { ok: true, active: started && !ready ? { recordingId: NEW, state: 'finalizing' } : null };
    if (op === 'start') { started = true; return { ok: true, recordingId: NEW }; }
    return { ok: true };
  });
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => {});
    await page.click(button(page, 'Record')!);
    assert.deepEqual(page.calls.push, []);
    assert.match(page.text(), /Saving your recording/);
    ready = true;
    await page.act(() => b.emit({ ownerId:ID,recordingId: NEW, state: 'ready' }));
    assert.deepEqual(page.calls.push, [`/review/recordings/${NEW}`]);
  } finally { page.cleanup(); }
});

test('an older list answer never overwrites a newer one', async () => {
  const first = deferred();
  let n = 0;
  const b = bridge((op) => {
    if (op === 'status') return { ok: true, active: null };
    if (op === 'list') {
      n++;
      if (n === 1) return first.promise;
      return { ok: true, recordings: [summary({ title: 'Newer' })], library };
    }
    return { ok: true };
  });
  const page = await render(NEW_REVIEW, {ownerId:ID}, { bridge: b.value });
  try {
    await page.act(() => { page.window.dispatchEvent(new page.window.Event('focus')); });
    assert.match(page.text(), /Newer/);
    await page.act(async () => { first.resolve({ ok: true, recordings: [summary({ title: 'Stale' })], library }); });
    assert.match(page.text(), /Newer/);
    assert.doesNotMatch(page.text(), /Stale/);
  } finally { page.cleanup(); }
});

test('the player loads a ready recording, previews it, saves moments, and revokes on unmount', async () => {
  const saved = [{ momentId: M1, startMs: 1_000, endMs: 4_000, region: null,
    card: { ...emptyCard(), whatToDo: 'Use the brand colour' }, createdAt: NOW }];
  const b = bridge((op, args) => {
    if (op === 'get') return { ok: true, recording: detail({}, saved) };
    if (op === 'preview') return previewOk;
    if (op === 'saveMoments') return { ok: true, moments: (args as { moments: unknown }).moments };
    return { ok: true };
  });
  const page = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    assert.equal(page.document.querySelector('video')!.getAttribute('src'), `implexa-artifact://preview/${TOKEN}`);
    assert.match(page.text(), new RegExp(MOMENTS_NEXT_NOTE));
    assert.equal((page.document.querySelector('textarea') as HTMLTextAreaElement).value, 'Use the brand colour');
    assert.match(page.text(), /20\/600/);
    const save = () => button(page, /Save moments|^Saved$/)!;
    assert.equal(save().hasAttribute('disabled'), true, 'nothing to save yet');
    await page.click(button(page, 'Delete')!);
    assert.equal(save().hasAttribute('disabled'), false);
    await page.click(save());
    assert.deepEqual(b.calls.find((c) => c.operation === 'saveMoments')?.args, { recordingId: ID, moments: [],expectedOwnerId:ID });
    assert.match(page.text(), /Moments saved on this Mac/);
    assert.deepEqual(ops(b), ['get', 'preview', 'saveMoments']);
  } finally { page.cleanup(); }
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(b.revoked, [TOKEN], 'the preview token is revoked when the player unmounts');
});

test('edits made while a save is in flight survive it and stay unsaved', async () => {
  const held = deferred();
  const start = [{ momentId: M1, startMs: 1_000, endMs: 4_000, region: null, card: emptyCard(), createdAt: NOW }];
  const b = bridge((op) => {
    if (op === 'get') return { ok: true, recording: detail({}, start) };
    if (op === 'preview') return previewOk;
    if (op === 'saveMoments') return held.promise;
    return { ok: true };
  });
  const page = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    const what = () => page.document.querySelector('textarea') as HTMLTextAreaElement;
    await typeInto(page, what(), 'Keep the price on screen');
    await page.click(button(page, 'Save moments')!);
    await typeInto(page, what(), 'Keep the price on screen always');
    const sent = (b.calls.find((c) => c.operation === 'saveMoments')!.args as { moments: Array<{ card: { whatToDo: string } }> }).moments;
    assert.equal(sent[0].card.whatToDo, 'Keep the price on screen');
    await page.act(async () => { held.resolve({ ok: true, moments: sent }); });
    assert.equal(what().value, 'Keep the price on screen always', 'the newer edit is kept');
    assert.equal(button(page, 'Save moments')!.hasAttribute('disabled'), false, 'and is still unsaved');
    assert.match(page.text(), /save again/);
  } finally { page.cleanup(); }
});

test('M marks at the playhead, refuses an empty mark, and is ignored while typing', async () => {
  const b = bridge((op) => {
    if (op === 'get') return { ok: true, recording: detail() };
    if (op === 'preview') return previewOk;
    return { ok: true };
  });
  const page = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    const video = page.document.querySelector('video')!;
    const at = (s: number) => Object.defineProperty(video, 'currentTime', { value: s, configurable: true, writable: true });
    at(2);
    await key(page, page.window, 'm');
    assert.match(page.text(), /Marking from 00:02\.000/);
    await key(page, page.window, 'm');
    assert.equal(page.document.querySelectorAll('textarea').length, 0, 'start === end makes no moment');
    assert.match(page.text(), /needs a start and an end/);
    at(5);
    await key(page, page.window, 'm');
    assert.equal(page.document.querySelectorAll('textarea').length, 5, 'one moment with five card fields');
    assert.match(page.text(), /00:02\.000–00:05\.000/);

    const field = page.document.querySelector('textarea')!;
    await key(page, field, 'm');
    assert.doesNotMatch(page.text(), /Marking from/, 'M typed into a card is just a letter');
  } finally { page.cleanup(); }
});

test('the player guards unsaved moments with a modal, and never with beforeunload inside Desktop', async () => {
  const b = bridge((op) => {
    if (op === 'get') return { ok: true, recording: detail() };
    if (op === 'preview') return previewOk;
    return { ok: true };
  });
  const page = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: b.value });
  const registered: string[] = [];
  const original = page.window.addEventListener.bind(page.window);
  page.window.addEventListener = ((type: string, ...rest: unknown[]) => { registered.push(type); return (original as (...a: unknown[]) => void)(type, ...rest); }) as typeof page.window.addEventListener;
  try {
    await page.act(() => {});
    const video = page.document.querySelector('video')!;
    Object.defineProperty(video, 'currentTime', { value: 1, configurable: true, writable: true });
    await key(page, page.window, 'm');
    Object.defineProperty(video, 'currentTime', { value: 3, configurable: true, writable: true });
    await key(page, page.window, 'm');
    assert.equal(page.document.querySelectorAll('textarea').length, 5);
    assert.equal(registered.includes('beforeunload'), false, 'Electron would silently block quit and reload');

    await page.click(page.document.querySelector('a[href="/review/new"]')!);
    assert.ok(page.document.querySelector('[role="dialog"]'), 'leaving with unsaved moments asks first');
    assert.deepEqual(page.calls.push, []);
    await page.click(button(page, 'Leave without saving')!);
    assert.deepEqual(page.calls.push, ['/review/new']);
  } finally { page.cleanup(); }
});

test('Draw region uses the Review Room overlay; keyboard Enter sets a box at the center', async () => {
  const start = [{ momentId: M1, startMs: 1_000, endMs: 4_000, region: null, card: emptyCard(), createdAt: NOW }];
  const b = bridge((op) => {
    if (op === 'get') return { ok: true, recording: detail({}, start) };
    if (op === 'preview') return previewOk;
    return { ok: true };
  });
  const page = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    const video = page.document.querySelector('video')!;
    // jsdom has no layout or media: give the element a box and the video a frame size.
    Object.assign(video, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450, right: 800, bottom: 450, x: 0, y: 0 }), pause: () => {} });
    Object.defineProperty(video, 'videoWidth', { value: 1600, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 900, configurable: true });
    assert.equal(page.document.querySelector('[data-testid="spatial-overlay"]'), null, 'not mounted until drawing');
    assert.match(page.text(), /Region: none/);
    await page.click(button(page, 'Draw region')!);
    const overlay = page.document.querySelector('[data-testid="spatial-overlay"]') as HTMLElement;
    assert.ok(overlay, 'the shared overlay is mounted');
    assert.equal(overlay.style.bottom, '0px', 'external transport leaves the whole picture available');
    assert.equal(video.hasAttribute('controls'), false);
    const transport = page.document.querySelector('[data-testid="playback-controls"]')!;
    assert.ok(transport.querySelector('button[aria-label="Play"]'));
    assert.equal(video.parentElement!.contains(transport), false, 'drawing cannot hit transport');
    await key(page, overlay, 'Enter');
    assert.match(page.text(), /Region: 20% × 20% at \(40%, 40%\)/);
    assert.equal(page.document.querySelector('[data-testid="spatial-overlay"]'), null, 'drawing ends');

    await page.click(button(page, 'Draw region')!);
    await key(page, page.document.querySelector('[data-testid="spatial-overlay"]')!, 'Escape');
    assert.equal(page.document.querySelector('[data-testid="spatial-overlay"]'), null, 'Escape cancels');
  } finally { page.cleanup(); }
});

test('drawing rejects a scrubbed or still-seeking frame without retiming the moment or changing its notes', async () => {
  const card = { ...emptyCard(), whatToDo: 'Preserve these exact notes', why: 'Keep this explanation' };
  const start = [{ momentId: M1, startMs: 1_000, endMs: 4_000, region: null, card, createdAt: NOW }];
  const b = bridge((op, args) => {
    if (op === 'get') return { ok: true, recording: detail({}, start) };
    if (op === 'preview') return previewOk;
    if (op === 'saveMoments') return { ok: true, moments: args.moments };
    return { ok: true };
  });
  const page = await render(PLAYER, { recordingId: ID, ownerId: ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    const video = page.document.querySelector('video')!;
    let seeking = false;
    Object.assign(video, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450, right: 800, bottom: 450, x: 0, y: 0 }), pause: () => {} });
    Object.defineProperties(video, { videoWidth: { value: 1600 }, videoHeight: { value: 900 }, seeking: { get: () => seeking } });
    await page.click(button(page, 'Draw region')!);
    assert.equal(video.currentTime, 1);
    video.currentTime = 8; // A user scrubs after choosing the moment.
    await key(page, page.document.querySelector('[data-testid="spatial-overlay"]')!, 'Enter');
    assert.match(page.text(), /picture moved from this moment’s start/); assert.match(page.text(), /Region: none/);
    assert.equal((page.document.querySelector('textarea') as HTMLTextAreaElement).value, card.whatToDo);
    await page.click(button(page, 'Draw region')!);
    seeking = true;
    await key(page, page.document.querySelector('[data-testid="spatial-overlay"]')!, 'Enter');
    assert.match(page.text(), /Region: none/);
    seeking = false;
    await key(page, page.document.querySelector('[data-testid="spatial-overlay"]')!, 'Enter');
    assert.match(page.text(), /Region: 20%/);
    await page.click(button(page, 'Save moments')!);
    const saved = b.calls.find((c) => c.operation === 'saveMoments')!.args.moments as typeof start;
    assert.equal(saved[0].startMs, 1000); assert.equal(saved[0].endMs, 4000);
    assert.deepEqual(saved[0].card, card); assert.ok(saved[0].region);
  } finally { page.cleanup(); }
});

test('card fields warn about text the learning rules will refuse, without blocking Save', async () => {
  const b = bridge((op) => {
    if (op === 'get') return { ok: true, recording: detail({}, [{ momentId: M1, startMs: 1_000, endMs: 4_000, region: null, card: emptyCard(), createdAt: NOW }]) };
    if (op === 'preview') return previewOk;
    return { ok: true };
  });
  const page = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    assert.equal(page.document.querySelectorAll('[data-testid="card-warning"]').length, 0);
    const [what, why] = [...page.document.querySelectorAll('textarea')] as HTMLTextAreaElement[];
    await typeInto(page, what, 'Short');
    await typeInto(page, why, 'see https://example.com');
    const warnings = [...page.document.querySelectorAll('[data-testid="card-warning"]')].map((w) => w.textContent);
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((w) => w!.startsWith('This will be refused when it becomes a learning')));
    assert.equal(button(page, 'Save moments')!.hasAttribute('disabled'), false, 'a warning, not a block');
  } finally { page.cleanup(); }
});

test('the player offers Recover for an interrupted recording and never asks for a preview', async () => {
  const b = bridge((op) => (op === 'get' ? { ok: true, recording: detail({ state: 'interrupted', durationMs: null }) } : { ok: true }));
  const page = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    await page.click(button(page, 'Recover')!);
    assert.deepEqual(ops(b), ['get', 'recover', 'get']);
    assert.deepEqual(b.calls[1].args, { recordingId: ID,expectedOwnerId:ID });
  } finally { page.cleanup(); }
});

test('a failed recording explains itself in plain English and offers Try again; a failed upload does not', async () => {
  const b = bridge((op) => (op === 'get' ? { ok: true, recording: detail({ state: 'failed', failureReason: 'finalize_failed', durationMs: null }) } : { ok: true }));
  const page = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: b.value });
  try {
    await page.act(() => {});
    assert.match(page.text(), new RegExp(FAILURE_REASON_MESSAGES.finalize_failed));
    assert.doesNotMatch(page.text(), /finalize_failed/);
    await page.click(button(page, 'Try again')!);
    assert.deepEqual(ops(b), ['get', 'recover', 'get']);
  } finally { page.cleanup(); }
  const up = bridge((op) => (op === 'get' ? { ok: true, recording: detail({ state: 'failed', origin: 'imported', failureReason: 'too_long', durationMs: null }) } : { ok: true }));
  const page2 = await render(PLAYER, { recordingId: ID,ownerId:ID }, { bridge: up.value });
  try {
    await page2.act(() => {});
    assert.match(page2.text(), new RegExp(FAILURE_REASON_MESSAGES.too_long));
    assert.equal(button(page2, 'Try again'), undefined);
  } finally { page2.cleanup(); }
});

test('Use in Training carries only saved recording/moment IDs and the existing Agent context',async()=>{
 const b=bridge(op=>op==='get'?{ok:true,recording:detail()}:op==='preview'?previewOk:{ok:true});
 const page=await render(PLAYER,{recordingId:ID,ownerId:ID,trainingSlug:'trained-video'},{bridge:b.value});
 try{
  await page.act(()=>{});
  const use=button(page,'Use in Training');assert.ok(use);await page.click(use!);
  assert.equal(page.calls.push.length,1);assert.match(page.calls.push[0],new RegExp(`^/training/trained-video\\?recordingId=${ID}`));
  assert.equal(b.calls.some(c=>['accept','annotate','selectRecording'].includes(c.operation)),false,'navigation grants no training authority');
  assert.equal(JSON.stringify(page.calls.push).includes('/Users/'),false);
 }finally{page.cleanup();}
});
