import test from 'node:test';
import assert from 'node:assert/strict';
import { render, type Rendered } from '../../../../lib/test/render.ts';
import { formatTrainingTime, previewMatches, TRAINING_LOCAL_CONTRACT_VERSION } from '../../../../lib/training-local-ingress.ts';

const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const TOKEN = '55555555-5555-4555-8555-555555555555';
const RECORD = '66666666-6666-4666-8666-666666666666';
const DIGEST = 'a'.repeat(64);
const SOURCE_DIGEST = 'b'.repeat(64);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

type Call = { operation: string; args: Record<string, unknown> };

function decision(state: 'draft' | 'accepted' = 'draft') {
  return {
    recordId: RECORD,
    recordDigest: DIGEST,
    state,
    content: {
      relation: 'contrast',
      properties: ['layout_variety'],
      summary: 'Chosen: a real map. Why: it grounds the claim. Process: download public map. Desired behavior: overlay the route.',
      anchor: { startMs: 83_125 },
    },
    decision: { chosen: 'a real map', why: 'it grounds the claim', process: 'download public map', desiredBehavior: 'overlay the route' },
  };
}

function source(state: 'draft' | 'accepted' = 'draft') {
  return {
    sourceId: SOURCE_ID,
    sourceReferenceDigest: 'c'.repeat(64),
    token: TOKEN,
    localName: 'approved-edit.mp4',
    metadata: { durationMs: 710_667, mediaType: 'video/mp4', sha256: SOURCE_DIGEST, width: 1920, height: 1080 },
    decisions: [decision(state)],
  };
}

function harness(options: {
  state?: 'draft' | 'accepted';
  currentVersion?: string | null;
  failedDrafts?: Array<Record<string, unknown>>;
  pendingDecisions?: Array<Record<string, unknown>>;
} = {}) {
  const calls: Call[] = [];
  let currentVersion = options.currentVersion === undefined ? VERSION_A : options.currentVersion;
  let decisionState = options.state || 'draft';
  const bridge = {
    trainingLocalContractVersion: '1',
    trainingLocal: async (operation: string, unknownArgs: unknown) => {
      const args = (unknownArgs || {}) as Record<string, unknown>;
      calls.push({ operation, args });
      if (operation === 'home') return { ok: true, home: { agent: { name: 'Video craft', currentVersionId: currentVersion }, recentSessions: [{ sessionId: SESSION, sourceMode: 'raw_input', terminal: false, agent: { baseVersionId: VERSION_A } }] } };
      if (operation === 'scope') return { ok: true, scope: { agent: { name: 'Video craft', currentVersionId: currentVersion }, ...(args.sessionId ? { session: { sessionId: SESSION, baseVersionId: VERSION_A, terminal: false } } : {}) } };
      if (operation === 'list') return { ok: true, sources: [source(decisionState)], failedDrafts: options.failedDrafts || [], pendingDecisions: options.pendingDecisions || [] };
      if (operation === 'decisionPreview') return { ok: true, image: PNG, recordId: RECORD, recordDigest: DIGEST };
      if (operation === 'accept') { decisionState = 'accepted'; return { ok: true, recordId: RECORD, recordDigest: DIGEST, state: 'accepted' }; }
      if (operation === 'revoke') { decisionState = 'draft'; return { ok: true, recordId: RECORD, recordDigest: DIGEST, state: 'revoked' }; }
      return { ok: true, image: PNG };
    },
  };
  return { bridge, calls, setCurrentVersion: (value: string | null) => { currentVersion = value; } };
}

async function renderedWith(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  const rendered = await render('../training/[slug]/training-source.tsx', { slug: 'video-craft' }, { bridge: h.bridge });
  return { ...h, rendered };
}

async function setInput(rendered: Rendered, input: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(rendered.window.HTMLInputElement.prototype, 'value')!.set!;
  await rendered.act(() => { setter.call(input, value); input.dispatchEvent(new rendered.window.Event('input', { bubbles: true })); });
}

async function setTextarea(rendered: Rendered, input: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(rendered.window.HTMLTextAreaElement.prototype, 'value')!.set!;
  await rendered.act(() => { setter.call(input, value); input.dispatchEvent(new rendered.window.Event('input', { bubbles: true })); });
}

test('timecodes and preview authority are exact to the source token and millisecond', () => {
  assert.equal(TRAINING_LOCAL_CONTRACT_VERSION, '1');
  assert.equal(formatTrainingTime(83_125), '01:23.125');
  assert.equal(formatTrainingTime(3_683_009), '01:01:23.009');
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, TOKEN, 1000), true);
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, TOKEN, 1001), false, 'a late old frame cannot authorize the new timestamp');
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, 'other-token', 1000), false, 'a frame cannot cross sources');
});

test('web, missing bridge method and wrong bridge version all fail closed with an update path', async () => {
  for (const bridge of [null, { version: '0.0.1' }, { trainingLocalContractVersion: '0', trainingLocal: async () => ({ ok: true }) }]) {
    const rendered = await render('../training/[slug]/training-source.tsx', { slug: 'video-craft' }, { bridge });
    try {
      await rendered.act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
      assert.match(rendered.text(), bridge && 'trainingLocal' in bridge ? /Update Implexa Desktop/ : /Open this page in an updated Implexa Desktop/);
    } finally { rendered.cleanup(); }
  }
});

test('source and session identities, exact time input and accessible range value are visible', async () => {
  const { rendered } = await renderedWith();
  try {
    assert.match(rendered.text(), /Train Video craft/);
    assert.match(rendered.text(), /Active version: 11111111 · Session version: 11111111/);
    assert.match(rendered.text(), /approved-edit.mp4 · 1920×1080 · 11:50.667 · SHA-256 bbbbbbbb/);
    await rendered.click(rendered.getByText('Annotate source'));
    const range = rendered.document.querySelector('input[type="range"]')!;
    assert.equal(range.getAttribute('aria-valuetext'), '00:00.000');
    const exact = rendered.document.querySelector('input[type="number"]')!;
    await setInput(rendered, exact, '83125');
    assert.equal(rendered.document.querySelector('input[type="range"]')!.getAttribute('aria-valuetext'), '01:23.125');
    assert.match(rendered.text(), /Selected time 01:23.125 of 11:50.667/);
  } finally { rendered.cleanup(); }
});

test('active-version drift is detected before evidence access and blocks the old session', async () => {
  const { rendered, calls, setCurrentVersion } = await renderedWith();
  try {
    await rendered.click(rendered.getByText('Annotate source'));
    setCurrentVersion(VERSION_B);
    await rendered.click(rendered.getByText('Preview this exact frame'));
    assert.match(rendered.text(), /active agent version changed/i);
    assert.match(rendered.text(), /frozen to 11111111/);
    assert.equal(calls.some((call) => call.operation === 'preview'), false, 'no local frame is disclosed after version drift');
    assert.equal((rendered.getByText('Add training source') as HTMLButtonElement).disabled, true);
  } finally { rendered.cleanup(); }
});

test('acceptance requires exact saved derivative review and explicit confirmation', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    assert.equal(rendered.queryByText('Accept this exact decision'), null, 'there is no blind accept in the list');
    await rendered.click(rendered.getByText('Review before accepting'));
    assert.match(rendered.text(), /Exact saved evidence/);
    assert.match(rendered.text(), /01:23.125/);
    assert.match(rendered.text(), /Contrastive example/);
    assert.match(rendered.text(), /layout variety/);
    assert.match(rendered.text(), new RegExp(DIGEST));
    assert.ok(rendered.document.querySelector(`img[src="${PNG}"]`), 'the immutable stored derivative is shown');
    assert.equal(rendered.document.activeElement?.id, 'decision-review-heading', 'keyboard and screen-reader focus enters the newly opened evidence review');
    const accept = rendered.getByText('Accept this exact decision') as HTMLButtonElement;
    assert.equal(accept.disabled, true);
    const checks = rendered.document.querySelectorAll('input[type="checkbox"]');
    await rendered.click(checks[checks.length - 1]);
    assert.equal((rendered.getByText('Accept this exact decision') as HTMLButtonElement).disabled, false);
    await rendered.click(rendered.getByText('Accept this exact decision'));
    const call = calls.find((item) => item.operation === 'accept')!;
    assert.deepEqual(JSON.parse(JSON.stringify(call.args)), { token: TOKEN, recordId: RECORD, expectedDigest: DIGEST });
  } finally { rendered.cleanup(); }
});

test('a decision preview with a mismatched immutable identity never opens acceptance', async () => {
  const h = harness();
  const original = h.bridge.trainingLocal;
  h.bridge.trainingLocal = async (operation, args) => operation === 'decisionPreview'
    ? { ok: true, image: PNG, recordId: RECORD, recordDigest: 'f'.repeat(64) }
    : original(operation, args);
  const rendered = await render('../training/[slug]/training-source.tsx', { slug: 'video-craft' }, { bridge: h.bridge });
  try {
    await rendered.click(rendered.getByText('Review before accepting'));
    assert.match(rendered.text(), /saved evidence identity could not be verified/i);
    assert.equal(rendered.queryByText('Accept this exact decision'), null);
  } finally { rendered.cleanup(); }
});

test('saving consumes the exact preview once and clears the form to prevent accidental duplicate drafts', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    await rendered.click(rendered.getByText('Annotate source'));
    await rendered.click(rendered.getByText('Preview this exact frame'));
    const textareas = rendered.document.querySelectorAll('textarea');
    for (let index = 0; index < textareas.length; index += 1) await setTextarea(rendered, textareas[index], `answer ${index}`);
    const save = rendered.getByText('Save decision draft') as HTMLButtonElement;
    assert.equal(save.disabled, false);
    await rendered.click(save);
    const annotation = calls.find((item) => item.operation === 'annotate')!;
    assert.equal(annotation.args.token, TOKEN);
    assert.equal(annotation.args.timeMs, 0);
    assert.equal((annotation.args.decision as Record<string, string>).chosen, 'answer 0');
    assert.equal((rendered.getByText('Save decision draft') as HTMLButtonElement).disabled, true);
    assert.ok(Array.from(rendered.document.querySelectorAll('textarea')).every((textarea) => textarea.value === ''));
    assert.equal(rendered.document.querySelector('img[alt^="Training source frame"]'), null, 'consumed preview no longer authorizes another save');
  } finally { rendered.cleanup(); }
});

test('accepted evidence has an explicit, confirmed revoke path', async () => {
  const { rendered, calls } = await renderedWith({ state: 'accepted' });
  try {
    await rendered.click(rendered.getByText('Review accepted evidence'));
    assert.equal((rendered.getByText('Revoke future selection') as HTMLButtonElement).disabled, true);
    const checks = rendered.document.querySelectorAll('input[type="checkbox"]');
    await rendered.click(checks[checks.length - 1]);
    await rendered.click(rendered.getByText('Revoke future selection'));
    const call = calls.find((item) => item.operation === 'revoke')!;
    assert.deepEqual(JSON.parse(JSON.stringify(call.args)), { token: TOKEN, recordId: RECORD, expectedDigest: DIGEST });
  } finally { rendered.cleanup(); }
});

test('only typed transient drafts offer Retry; permanent drafts offer discard', async () => {
  const retrySource = { token: '77777777-7777-4777-8777-777777777777', retryable: true, reason: 'training_network_unavailable' };
  const permanentSource = { token: '88888888-8888-4888-8888-888888888888', retryable: false, reason: 'duplicate_source' };
  const retryDecision = { token: TOKEN, key: '99999999-9999-4999-8999-999999999999', retryable: true, reason: 'training_registration_pending' };
  const permanentDecision = { token: TOKEN, key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', retryable: false, reason: 'duplicate_decision' };
  const { rendered, calls } = await renderedWith({ failedDrafts: [retrySource, permanentSource], pendingDecisions: [retryDecision, permanentDecision] });
  try {
    const buttonTexts = Array.from(rendered.document.querySelectorAll('button')).map((button) => button.textContent);
    assert.equal(buttonTexts.filter((text) => text === 'Retry registration').length, 1);
    assert.equal(buttonTexts.filter((text) => text === 'Retry saved decision').length, 1);
    assert.equal(buttonTexts.filter((text) => text === 'Discard local draft').length, 2);
    await rendered.click(rendered.getByText('Retry registration'));
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find((item) => item.operation === 'register')?.args)), { token: retrySource.token });
    await rendered.click(rendered.getByText('Retry saved decision'));
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find((item) => item.operation === 'retryDraft')?.args)), { token: TOKEN, key: retryDecision.key });
  } finally { rendered.cleanup(); }
});

test('an agent without an immutable active version cannot add evidence', async () => {
  const { rendered } = await renderedWith({ currentVersion: null });
  try {
    assert.match(rendered.text(), /Active version: none/);
    assert.equal((rendered.getByText('Add training source') as HTMLButtonElement).disabled, true);
  } finally { rendered.cleanup(); }
});
