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
  interpretPreviewResult, isSafePreviewUrl, parsePreviewUrl,
  previewText, previewTextTruncated, desktopReviewHref,
  parseStagePreviewRead, parseStagePreviewView, stagePreviewTokens, requestStagePreview, parseStageTemporalSummary,
} from './review-preview.ts';

const TOKEN = 'a'.repeat(24);
const GOOD = `implexa-artifact://preview/${TOKEN}`;
test('owner decision digest is retained only for a passing held Preview, never inferred from old views', () => {
  const summary={contractVersion:'stage-preview-summary.v1' as const,runId:'10000000-0000-4000-8000-000000000001',
    preparationId:'10000000-0000-4000-8000-000000000002',receiptDigest:'a'.repeat(64),
    machineId:'10000000-0000-4000-8000-000000000003',reviewState:'pass' as const,ownerHoldReady:true};
  const view={...summary,ok:true,contractVersion:'stage-preview-local-view.v1',readOnly:true,ownerApproved:false,
    temporalQaPassed:false,criteria:[],judgments:[],items:[]};
  assert.equal(parseStagePreviewView(view,summary)?.decisionDigest,null);
  assert.equal(parseStagePreviewView({...view,decisionDigest:'b'.repeat(64)},summary)?.decisionDigest,'b'.repeat(64));
  for(const decisionDigest of ['not-a-digest',true,{},'b'.repeat(65)])
    assert.equal(parseStagePreviewView({...view,decisionDigest},summary),null);
  assert.equal(parseStagePreviewView({...view,decisionDigest:'b'.repeat(64),ownerHoldReady:false},summary),null);
  assert.equal(parseStagePreviewView({...view,decisionDigest:'b'.repeat(64)}, {...summary,ownerHoldReady:false}),null);
});
test('temporal Preview decoding preserves the 2-of-8 offset proof rather than claiming all offsets verified', () => {
  const t={contractVersion:'stage-preview-temporal-summary.v1',status:'passed',calibrationDigest:'a'.repeat(64),
    slotCount:8,passedSlotCount:8,offsetIndexProvenSlotCount:2,notVisuallyResolvableSlotCount:6,
    slots:Array.from({length:8},(_,i)=>({sceneId:'scene-1',slotId:`slot-${i}`,verdict:'passed',
      offsetEvidence:i<2?'informative':'not_visually_resolvable'}))};
  assert.deepEqual(parseStageTemporalSummary(t),t);
  for(const delta of [{offsetIndexProvenSlotCount:8},{notVisuallyResolvableSlotCount:0},{slots:[]},{passedSlotCount:7},
    {status:'not_applicable'},{calibrationDigest:null},{slots:[null,...t.slots.slice(1)]},
    {slots:[{...t.slots[0],offsetEvidence:'verified'},...t.slots.slice(1)]}])assert.equal(parseStageTemporalSummary({...t,...delta}),null);
});
test('Preview displays provider N/A explicitly without turning it into a passing judgment', () => {
  const summary = { contractVersion: 'stage-preview-summary.v1' as const, runId: '10000000-0000-4000-8000-000000000001',
    preparationId: '10000000-0000-4000-8000-000000000002', receiptDigest: 'a'.repeat(64),
    machineId: '10000000-0000-4000-8000-000000000003', reviewState: 'pass' as const, ownerHoldReady: true };
  const view = { ...summary, ok: true, contractVersion: 'stage-preview-local-view.v1', readOnly: true, ownerApproved: false,
    temporalQaPassed: false, criteria: [{ id: 'clip_fit', requirement: 'Relevant supplied provider slots.' }], items: [],
    temporalQa: { contractVersion: 'stage-preview-temporal-summary.v1', status: 'not_applicable', calibrationDigest: null,
      slotCount: 0, passedSlotCount: 0, offsetIndexProvenSlotCount: 0, notVisuallyResolvableSlotCount: 0, slots: [] },
    judgments: [{ criterionId: 'clip_fit', verdict: 'not_applicable', reason: 'Not applicable: no provider windows', frameIds: [] }] };
  const parsed = parseStagePreviewView(view, summary);
  assert.equal(parsed?.judgments[0].verdict, 'not_applicable');
  assert.equal(parsed?.judgments[0].reason, 'Not applicable: no provider windows');
  assert.equal(parsed?.judgments.some(j => j.verdict === 'pass'), false); assert.equal(parsed?.decisionDigest, null);
  assert.equal(parseStagePreviewView({ ...view, temporalQa: undefined }, summary), null);
  for (const delta of [{ reason: 'optional' }, { frameIds: ['frame-1'] }])
    assert.equal(parseStagePreviewView({ ...view, judgments: [{ ...view.judgments[0], ...delta }] }, summary), null);
});

test('stage Preview metadata is exact, read-only and separate from delivery validation', () => {
  const runId='10000000-0000-4000-8000-000000000001';
  const summary={contractVersion:'stage-preview-summary.v1',runId,preparationId:'10000000-0000-4000-8000-000000000002',
    receiptDigest:'a'.repeat(64),machineId:'10000000-0000-4000-8000-000000000003',reviewState:'pass',ownerHoldReady:true};
  const response={ok:true,run:{id:runId,stagePreview:summary}};
  assert.deepEqual(parseStagePreviewRead(response,runId),{state:'ready',summary});
  assert.deepEqual(parseStagePreviewRead({ok:true,run:{id:runId,stagePreview:null}},runId),{state:'not_applicable'});
  for(const bad of [{ok:true,run:{id:runId}}, {...response,run:{id:'wrong',stagePreview:summary}},
    ...[{preparationId:'../local'},{ownerHoldReady:'yes'},{reviewState:'approved'},{hostPath:'/private/custody'}]
      .map(delta=>({ok:true,run:{id:runId,stagePreview:{...summary,...delta}}}))])
    assert.equal(parseStagePreviewRead(bad,runId).state,'unavailable');
  assert.equal(decidePreview({artifact:{status:'declared',relativePath:'preview.png'},inDesktop:true,bridgeSupported:true}).state,'not_validated');
});

test('stage Preview collection binds all identities and accepts only opaque typed media', async () => {
  const summary={contractVersion:'stage-preview-summary.v1' as const,runId:'10000000-0000-4000-8000-000000000001',
    preparationId:'10000000-0000-4000-8000-000000000002',receiptDigest:'a'.repeat(64),
    machineId:'10000000-0000-4000-8000-000000000003',reviewState:'pass' as const,ownerHoldReady:true};
  const view={ok:true,contractVersion:'stage-preview-local-view.v1',...summary,readOnly:true,ownerApproved:false,temporalQaPassed:false,
    criteria:[{id:'clarity',requirement:'Readable title',artifactPath:'compose/scene.json'}],
    judgments:[{criterionId:'clarity',verdict:'pass',reason:'Visible in frame-1.',frameIds:['frame-1']}],
    items:[{id:'frame-1',kind:'full_resolution',mime:'image/png',url:GOOD}]};
  view.contractVersion='stage-preview-local-view.v1';
  assert.equal(parseStagePreviewView(view,summary)?.criteria[0].statement,'Readable title');
  assert.deepEqual(stagePreviewTokens(view),[TOKEN]);
  for(const delta of [{runId:'wrong'},{preparationId:'wrong'},{machineId:'wrong'},{receiptDigest:'f'.repeat(64)},
    {reviewState:'fail'},{ownerApproved:true},{temporalQaPassed:true},{readOnly:false},
    {items:[{...view.items[0],url:'file:///private/custody/frame.png'}]},
    {items:[{...view.items[0],kind:'internal_context'}]},{items:[...view.items,...view.items]},
    {items:[{...view.items[0],mime:'text/html'}]},
    {judgments:[{...view.judgments[0],criterionId:'unknown'}]}]) assert.equal(parseStagePreviewView({...view,...delta},summary),null);
  assert.equal((await requestStagePreview('../wrong',summary.preparationId) as {error:string}).error,'bad_request');
  assert.equal((await requestStagePreview(summary.runId,summary.preparationId) as {error:string}).error,'desktop_required');
});

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

test('REPRO: browser-to-Desktop handoff preserves the exact review run', () => {
  const runId = 'd36143db-b53e-463e-b959-148f722705ea';
  assert.equal(desktopReviewHref(runId), `implexa://review/${runId}`);
  assert.equal(desktopReviewHref('../settings'), null);
  assert.equal(desktopReviewHref('d36143db-b53e-463e-b959-148f722705ea/../../settings'), null);
  assert.equal(desktopReviewHref('not-a-run'), null);
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
  // The token must be long enough to be a real capability — 'abc123' is guessable, and
  // the strict parser refuses it.
  const ok = interpretPreviewResult({ ok: true, url: GOOD }, 'video');
  assert.equal(ok.state, 'ready');
  assert.notEqual(interpretPreviewResult({ ok: true, url: 'implexa-artifact://preview/abc123' }, 'video').state, 'ready');

  // anything path-shaped is refused as ready
  for (const url of ['/Users/me/final.mp4', 'file:///Users/me/final.mp4', 'https://evil/x', '']) {
    const d = interpretPreviewResult({ ok: true, url }, 'video');
    assert.notEqual(d.state, 'ready', `${url} must not be treated as a preview URL`);
  }
});

test('REPRO: the URL guard is an ALLOWLIST, not a /Users/ denylist', () => {
  // The first version blocked only the literal "/Users/" and accepted everything else,
  // and the ONLY negative case tested was /Users/ — so the test passed while every
  // other path root sailed through. These are the shapes that used to be accepted.
  const wasAccepted = [
    'implexa-artifact:///home/me/a.mp4',
    'implexa-artifact:///var/folders/x/final.mp4',
    'implexa-artifact:///tmp/a.mp4',
    'implexa-artifact://preview/../../etc/passwd',
    'implexa-artifact://C:\\Users\\me\\a.mp4',
    'implexa-artifact://preview/tok/../..',
    'implexa-artifact://preview/tok%2F..%2Fetc',
  ];
  for (const u of wasAccepted) {
    assert.equal(isSafePreviewUrl(u), false, `${u} must be refused — a guard is only as good as its allowlist`);
  }
});

test('only the exact opaque preview shape is accepted, and it yields its token', () => {
  assert.equal(isSafePreviewUrl(GOOD), true);
  assert.deepEqual(parsePreviewUrl(GOOD), { token: TOKEN });

  for (const u of [
    'implexa-artifact://preview/short',              // too short to be a real capability
    'implexa-artifact://preview/',                   // no token
    'implexa-artifact://preview',                    // no path
    'implexa-artifact://other/' + 'a'.repeat(24),    // wrong segment
    `implexa-artifact://preview/${TOKEN}/extra`,     // trailing segment
    `implexa-artifact://preview/${TOKEN}?x=1`,       // query
    `implexa-artifact://preview/${TOKEN}#f`,         // fragment
    `IMPLEXA-ARTIFACT://preview/${TOKEN}`,           // scheme case
    'file:///Users/me/a.mp4', '/Users/me/a.mp4', 'https://evil/x', '', null, undefined, 42, {},
  ]) {
    assert.equal(isSafePreviewUrl(u as never), false, `${String(u)} must not be accepted`);
    assert.equal(parsePreviewUrl(u as never), null);
  }
});

test('BOTH parsers agree — interpretPreviewResult uses the same allowlist', () => {
  // Previously interpretPreviewResult accepted any string starting with the scheme
  // while the renderer applied a different rule, so the two could disagree about the
  // same value. There is now one parser.
  assert.equal(interpretPreviewResult({ ok: true, url: GOOD }, 'video').state, 'ready');
  for (const u of ['implexa-artifact:///home/me/a.mp4', 'implexa-artifact://preview/../../etc/passwd', 'implexa-artifact://preview/short']) {
    const d = interpretPreviewResult({ ok: true, url: u }, 'video');
    assert.notEqual(d.state, 'ready', `${u} must not be reported ready`);
    assert.equal(isSafePreviewUrl(u), false, 'and the renderer must agree');
  }
});

test('the extension parser reads the FINAL SEGMENT and a clean extension', () => {
  // NOT a repro. The original (KIND_BY_EXT[...] ?? 'unsupported') was already an
  // allowlist BY CONSTRUCTION — an odd remainder simply missed the map. Mutating either
  // guard here still passes, and that is the honest result: this hardening makes the
  // intent explicit and keeps the parser safe if the map is ever replaced by a looser
  // lookup, but it is defence in depth, not a bug fix. The real P1 was the URL guard.
  assert.equal(previewKind('a.mp4/../../etc/passwd'), 'unsupported');
  assert.equal(previewKind('out/final.mp4'), 'video');
  assert.equal(previewKind('C:\\clips\\a.mp4'), 'video', 'windows separators resolve to the basename too');
  assert.equal(previewKind('.mp4'), 'unsupported', 'a dotfile has a name, not an extension');
  assert.equal(previewKind('final.'), 'unsupported');
  assert.equal(previewKind('noext'), 'unsupported');
  assert.equal(previewKind('..'), 'unsupported');
  assert.equal(previewKind('x.mp4.exe'), 'unsupported', 'only the real trailing extension counts');
  assert.equal(previewKind('a.m p4'), 'unsupported', 'a non-alphanumeric extension is not acted on');
});

// ── text arrives on the BRIDGE RESPONSE, not from the preview URL ────────────
//
// Desktop #42 finding: this used to be `fetch(previewUrl)`, which can never work —
// Chromium refuses fetch() to a non-http(s) scheme from an http(s) page before any
// handler runs. Media/image elements are no-cors and unaffected, so every
// markdown/json/txt/csv preview failed while the videos looked fine.

test('previewText reads the text the desktop supplied', () => {
  assert.equal(previewText({ ok: true, text: '# hello' }), '# hello');
});

test('an EMPTY string is a real answer and is preserved, not turned into a failure', () => {
  // An empty artifact is empty. Collapsing that to null would tell the reviewer we
  // could not read the file, which is a different and false statement.
  assert.equal(previewText({ ok: true, text: '' }), '');
});

test('missing or non-string text is null, so the caller can say it could not be read', () => {
  for (const r of [
    { ok: true },                       // desktop supplied none
    { ok: true, text: null },
    { ok: true, text: 42 },
    { ok: true, text: { a: 1 } },
    { ok: false, text: 'x' },           // the preview itself failed
    null, undefined, 'nope',
  ]) {
    assert.equal(previewText(r), null, `should be null: ${JSON.stringify(r)}`);
  }
});

test('truncation is reported only when the desktop actually says so', () => {
  assert.equal(previewTextTruncated({ ok: true, text: 'x', textTruncated: true }), true);
  assert.equal(previewTextTruncated({ ok: true, text: 'x', textTruncated: false }), false);
  assert.equal(previewTextTruncated({ ok: true, text: 'x' }), false);
  // Never inferred from a truthy value — a clipped-file notice must be a fact.
  assert.equal(previewTextTruncated({ ok: true, textTruncated: 'yes' }), false);
  assert.equal(previewTextTruncated(null), false);
});
