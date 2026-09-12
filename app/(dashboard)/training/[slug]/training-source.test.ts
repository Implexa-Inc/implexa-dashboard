import test from 'node:test';
import assert from 'node:assert/strict';
import { render, type Rendered } from '../../../../lib/test/render.ts';
import { deriveTrainingStages, formatTrainingTime, normalizeTrainingStages, previewMatches, TRAINING_LOCAL_CONTRACT_VERSION, TRAINING_STAGE_ROUTING_VERSION } from '../../../../lib/training-local-ingress.ts';

const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const NEW_SESSION = '33333333-3333-4333-8333-333333333334';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const TOKEN = '55555555-5555-4555-8555-555555555555';
const RECORD = '66666666-6666-4666-8666-666666666666';
const DIGEST = 'a'.repeat(64);
const SOURCE_DIGEST = 'b'.repeat(64);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

type Call = { operation: string; args: Record<string, unknown> };

function decision(state: 'draft' | 'accepted' = 'draft', stages: string[] = ['preview', 'build', 'qa']) {
  return {
    recordId: RECORD,
    recordDigest: DIGEST,
    state,
    content: {
      relation: 'contrast',
      properties: ['layout_variety'],
      summary: 'Chosen: a real map. Why: it grounds the claim. Process: download public map. Desired behavior: overlay the route.',
      anchor: { startMs: 83_125 },
      applicability: { stages },
    },
    decision: { chosen: 'a real map', why: 'it grounds the claim', process: 'download public map', desiredBehavior: 'overlay the route' },
  };
}

function source(state: 'draft' | 'accepted' = 'draft', stages?: string[]) {
  return {
    sourceId: SOURCE_ID,
    sourceReferenceDigest: 'c'.repeat(64),
    token: TOKEN,
    localName: 'approved-edit.mp4',
    metadata: { durationMs: 710_667, mediaType: 'video/mp4', sha256: SOURCE_DIGEST, width: 1920, height: 1080 },
    decisions: [decision(state, stages)],
  };
}

const planningPair = { stage: 'planning', property: 'layout_variety', relation: 'contrast' };
function coverage(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'manager-training-coverage.v1',
    scope: 'workflow_version',
    workflowVersionId: VERSION_A,
    classified: true,
    acceptedLocalRecordCount: 1,
    listedSessionAcceptedRecordCount: 1,
    acceptedPairs: [planningPair],
    listedSessionAcceptedPairs: [planningPair],
    coveredPairs: [planningPair],
    uncoveredPairs: [],
    readiness: 'ready',
    reason: null,
    ...overrides,
  };
}

function harness(options: {
  state?: 'draft' | 'accepted';
  currentVersion?: string | null;
  failedDrafts?: Array<Record<string, unknown>>;
  pendingDecisions?: Array<Record<string, unknown>>;
  stages?: string[];
  managerCoverage?: Record<string, unknown>;
  successorSha?: string;
  successorBaseVersion?: string;
} = {}) {
  const calls: Call[] = [];
  let currentVersion = options.currentVersion === undefined ? VERSION_A : options.currentVersion;
  let decisionState = options.state || 'draft';
  let successorSelected = false;
  const bridge = {
    trainingLocalContractVersion: '2',
    trainingLocal: async (operation: string, unknownArgs: unknown) => {
      const args = (unknownArgs || {}) as Record<string, unknown>;
      calls.push({ operation, args });
      if (operation === 'home') return { ok: true, home: { agent: { name: 'Video craft', currentVersionId: currentVersion }, recentSessions: [{ sessionId: SESSION, sourceMode: 'raw_input', terminal: false, agent: { baseVersionId: VERSION_A } }] } };
      if (operation === 'scope') return { ok: true, scope: { agent: { name: 'Video craft', currentVersionId: currentVersion }, ...(args.sessionId ? { session: { sessionId: String(args.sessionId), baseVersionId: args.sessionId === NEW_SESSION ? (options.successorBaseVersion || currentVersion) : VERSION_A, terminal: false } } : {}) } };
      if (operation === 'create') return { ok: true, sessionId: NEW_SESSION };
      if (operation === 'select' && args.sessionId === NEW_SESSION) successorSelected = true;
      if (operation === 'list') { const next = source('draft', options.stages); if (options.successorSha) next.metadata.sha256 = options.successorSha; return { ok: true, sources: args.sessionId === NEW_SESSION ? (successorSelected ? [{ ...next, decisions: [] }] : []) : [source(decisionState, options.stages)], failedDrafts: options.failedDrafts || [], pendingDecisions: options.pendingDecisions || [], managerCoverage: options.managerCoverage }; }
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

async function setSelect(rendered: Rendered, input: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(rendered.window.HTMLSelectElement.prototype, 'value')!.set!;
  await rendered.act(() => { setter.call(input, value); input.dispatchEvent(new rendered.window.Event('change', { bubbles: true })); });
}

test('timecodes and preview authority are exact to the source token and millisecond', () => {
  assert.equal(TRAINING_LOCAL_CONTRACT_VERSION, '2');
  assert.equal(TRAINING_STAGE_ROUTING_VERSION, 'manager-training-applicability.v1');
  assert.deepEqual(deriveTrainingStages('motion_rhythm'), ['planning', 'build', 'preview', 'qa', 'revision']);
  assert.deepEqual(deriveTrainingStages('layout_variety'), ['planning', 'scene_contract', 'build', 'preview', 'qa', 'revision']);
  assert.deepEqual(normalizeTrainingStages(['planning', 'unknown', 'planning', 'qa']), ['planning', 'qa']);
  assert.deepEqual(normalizeTrainingStages(['qa', 'planning']), ['planning', 'qa'], 'equivalent stage sets have one canonical wire order');
  assert.equal(formatTrainingTime(83_125), '01:23.125');
  assert.equal(formatTrainingTime(3_683_009), '01:01:23.009');
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, TOKEN, 1000), true);
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, TOKEN, 1001), false, 'a late old frame cannot authorize the new timestamp');
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, 'other-token', 1000), false, 'a frame cannot cross sources');
});

test('web, missing bridge method and stale bridge versions all fail closed with an update path', async () => {
  for (const bridge of [null, { version: '0.0.1' }, { trainingLocalContractVersion: '1', trainingLocal: async () => ({ ok: true }) }]) {
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
    assert.match(rendered.text(), /remain immutable on 11111111/);
    assert.equal(calls.some((call) => call.operation === 'preview'), false, 'no local frame is disclosed after version drift');
    assert.equal((rendered.getByText('Add training source') as HTMLButtonElement).disabled, true);
  } finally { rendered.cleanup(); }
});

test('version transition requires coach confirmation, exact-source re-selection, and a fresh successor draft', async () => {
  const { rendered, calls, setCurrentVersion } = await renderedWith({ state: 'accepted', stages: ['planning', 'build', 'preview', 'qa'] });
  try {
    setCurrentVersion(VERSION_B);
    await rendered.click(rendered.getByText('Review accepted evidence'));
    assert.match(rendered.text(), /session and its accepted decisions remain immutable on 11111111/i);
    const start = rendered.getByText('Start successor training session') as HTMLButtonElement;
    assert.equal(start.disabled, true);
    const confirmation = rendered.getByText(/I understand this creates new evidence records/).closest('label')!.querySelector('input')!;
    await rendered.click(confirmation);
    assert.equal((rendered.getByText('Start successor training session') as HTMLButtonElement).disabled, false);
    await rendered.click(rendered.getByText('Start successor training session'));
    const create = calls.find((call) => call.operation === 'create')!;
    assert.equal(create.args.slug, 'video-craft');
    assert.match(String(create.args.key), /^[a-f0-9-]{36}$/);
    assert.match(rendered.text(), /records below remain bound to 11111111/);
    assert.match(rendered.text(), /Re-add source SHA-256 bbbbbbbb/);
    assert.equal((rendered.getByText('Prepare new-version successor draft') as HTMLButtonElement).disabled, true, 'an old token cannot cross versions');

    const consent = rendered.getByText(/I created this source and consent/).closest('label')!.querySelector('input')!;
    await rendered.click(consent);
    await rendered.click(rendered.getByText('Add training source'));
    assert.equal(calls.some((call) => call.operation === 'select' && call.args.sessionId === NEW_SESSION), true);
    assert.equal((rendered.getByText('Prepare new-version successor draft') as HTMLButtonElement).disabled, false, 'the newly verified source has the exact prior SHA');
    await rendered.click(rendered.getByText('Prepare new-version successor draft'));
    assert.match(rendered.text(), /Selected time 01:23.125/);
    assert.equal((rendered.getByText('Save decision draft') as HTMLButtonElement).disabled, true, 'copied prose never bypasses a fresh frame preview');
    await rendered.click(rendered.getByText('Preview this exact frame'));
    await rendered.click(rendered.getByText('Save decision draft'));
    const annotation = calls.filter((call) => call.operation === 'annotate').at(-1)!;
    assert.equal(annotation.args.token, TOKEN);
    assert.equal(annotation.args.timeMs, 83_125);
    assert.deepEqual(JSON.parse(JSON.stringify(annotation.args.decision)), decision('accepted').decision);
    assert.deepEqual(JSON.parse(JSON.stringify((annotation.args.content as { applicability: { stages: string[] } }).applicability.stages)), ['planning', 'build', 'preview', 'qa']);
    assert.equal(calls.some((call) => call.operation === 'accept' || call.operation === 'revoke'), false, 'the successor remains a draft until separately reviewed and confirmed');
  } finally { rendered.cleanup(); }
});

test('version successor refuses a raced version binding and never enables a different source hash', async () => {
  const raced = await renderedWith({ state: 'accepted', successorBaseVersion: VERSION_A });
  try {
    raced.setCurrentVersion(VERSION_B);
    await raced.rendered.click(raced.rendered.getByText('Review accepted evidence'));
    await raced.rendered.click(raced.rendered.getByText(/I understand this creates new evidence records/).closest('label')!.querySelector('input')!);
    await raced.rendered.click(raced.rendered.getByText('Start successor training session'));
    assert.match(raced.rendered.text(), /successor session was not bound to the active immutable version/i);
    assert.match(raced.rendered.text(), /Session version: 11111111/);
  } finally { raced.rendered.cleanup(); }

  const mismatched = await renderedWith({ state: 'accepted', successorSha: 'f'.repeat(64) });
  try {
    mismatched.setCurrentVersion(VERSION_B);
    await mismatched.rendered.click(mismatched.rendered.getByText('Review accepted evidence'));
    await mismatched.rendered.click(mismatched.rendered.getByText(/I understand this creates new evidence records/).closest('label')!.querySelector('input')!);
    await mismatched.rendered.click(mismatched.rendered.getByText('Start successor training session'));
    await mismatched.rendered.click(mismatched.rendered.getByText(/I created this source and consent/).closest('label')!.querySelector('input')!);
    await mismatched.rendered.click(mismatched.rendered.getByText('Add training source'));
    assert.match(mismatched.rendered.text(), /Re-add source SHA-256 bbbbbbbb/);
    assert.equal((mismatched.rendered.getByText('Prepare new-version successor draft') as HTMLButtonElement).disabled, true);
    assert.equal(mismatched.calls.some((call) => call.operation === 'annotate' || call.operation === 'accept'), false);
  } finally { mismatched.rendered.cleanup(); }
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
    assert.deepEqual(JSON.parse(JSON.stringify((annotation.args.content as { applicability: { stages: string[] } }).applicability.stages)), ['planning', 'build', 'preview', 'qa', 'revision']);
    assert.equal((rendered.getByText('Save decision draft') as HTMLButtonElement).disabled, true);
    assert.ok(Array.from(rendered.document.querySelectorAll('textarea')).every((textarea) => textarea.value === ''));
    assert.equal(rendered.document.querySelector('img[alt^="Training source frame"]'), null, 'consumed preview no longer authorizes another save');
  } finally { rendered.cleanup(); }
});

test('stage applicability is visible, derived from the property, and sent exactly as selected', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    await rendered.click(rendered.getByText('Annotate source'));
    assert.match(rendered.text(), /When may the Manager use this decision/);
    assert.match(rendered.text(), /before tools, generation, or paid actions/);
    assert.match(rendered.text(), new RegExp(TRAINING_STAGE_ROUTING_VERSION));
    const selects = rendered.document.querySelectorAll('select');
    await setSelect(rendered, selects[1], 'layout_variety');
    const planning = rendered.getByText('Plan the treatment').closest('label')!.querySelector('input') as HTMLInputElement;
    const scenes = rendered.getByText('Design scene contracts').closest('label')!.querySelector('input') as HTMLInputElement;
    const assets = rendered.getByText('Select assets').closest('label')!.querySelector('input') as HTMLInputElement;
    assert.equal(planning.checked, true);
    assert.equal(scenes.checked, true, 'layout decisions are derived as scene-contract relevant');
    assert.equal(assets.checked, false, 'unrelated stages are not silently broadened');
    await rendered.click(planning);
    await rendered.click(rendered.getByText('Preview this exact frame'));
    for (const [index, textarea] of Array.from(rendered.document.querySelectorAll('textarea')).entries()) await setTextarea(rendered, textarea, `answer ${index}`);
    await rendered.click(rendered.getByText('Save decision draft'));
    const annotation = calls.find((item) => item.operation === 'annotate')!;
    assert.deepEqual(JSON.parse(JSON.stringify((annotation.args.content as { applicability: { stages: string[] } }).applicability.stages)), ['scene_contract', 'build', 'preview', 'qa', 'revision']);
  } finally { rendered.cleanup(); }
});

test('a decision with no eligible Manager stage cannot be saved', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    await rendered.click(rendered.getByText('Annotate source'));
    await rendered.click(rendered.getByText('Preview this exact frame'));
    for (const [index, textarea] of Array.from(rendered.document.querySelectorAll('textarea')).entries()) await setTextarea(rendered, textarea, `answer ${index}`);
    for (const label of ['Plan the treatment', 'Build the composition', 'Review previews', 'Check final quality', 'Revise from feedback']) {
      await rendered.click(rendered.getByText(label).closest('label')!.querySelector('input')!);
    }
    assert.equal((rendered.getByText('Save decision draft') as HTMLButtonElement).disabled, true);
    assert.equal(calls.some((item) => item.operation === 'annotate'), false);
  } finally { rendered.cleanup(); }
});

test('an accepted execution-only record stays immutable and requires an independently reviewed planning successor', async () => {
  const { rendered, calls } = await renderedWith({ state: 'accepted', stages: ['preview', 'build', 'qa'] });
  try {
    assert.match(rendered.text(), /cannot guide planning before tools or paid actions/);
    await rendered.click(rendered.getByText('Review accepted evidence'));
    assert.match(rendered.text(), /Eligible stagesBuild the composition, Review previews, Check final quality/);
    await rendered.click(rendered.getByText('Create planning-scoped successor'));
    assert.equal(calls.some((call) => call.operation === 'annotate' || call.operation === 'accept' || call.operation === 'revoke'), false, 'opening a successor never mutates the accepted record');
    assert.match(rendered.text(), /Selected time 01:23.125/);
    const save = rendered.getByText('Save decision draft') as HTMLButtonElement;
    assert.equal(save.disabled, true, 'the immutable derivative must be previewed again before a successor can be saved');
    const planning = rendered.getByText('Plan the treatment').closest('label')!.querySelector('input') as HTMLInputElement;
    assert.equal(planning.checked, true);
  } finally { rendered.cleanup(); }
});

test('server-owned Manager coverage exposes unclassified and fully covered agent versions without client inference', async () => {
  const blocked = await renderedWith({ state: 'accepted', managerCoverage: coverage({ classified: false, coveredPairs: [], uncoveredPairs: [planningPair], readiness: 'agent_update_required', reason: 'manager_quality_coverage_unclassified_training' }) });
  try {
    assert.match(blocked.rendered.text(), /Agent update required before this evidence can guide runs/);
    assert.match(blocked.rendered.text(), /no Manager training-coverage policy/);
    assert.match(blocked.rendered.text(), /Plan the treatment · layout variety · Contrastive example/);
  } finally { blocked.rendered.cleanup(); }

  const ready = await renderedWith({ state: 'accepted', managerCoverage: coverage() });
  try {
    assert.match(ready.rendered.text(), /Manager coverage for all 1 accepted stage-scoped evidence routes across all training sessions/);
    assert.doesNotMatch(ready.rendered.text(), /Agent update required/);
  } finally { ready.rendered.cleanup(); }
});

test('stale or incomplete Manager coverage can never create a false-ready claim', async () => {
  for (const managerCoverage of [
    coverage({ workflowVersionId: VERSION_B }),
    coverage({ scope: 'session' }),
    coverage({ listedSessionAcceptedRecordCount: 0, listedSessionAcceptedPairs: [] }),
    coverage({ acceptedLocalRecordCount: 0 }),
    coverage({ classified: false }),
    coverage({ coveredPairs: [] }),
  ]) {
    const { rendered } = await renderedWith({ state: 'accepted', managerCoverage });
    try {
      assert.match(rendered.text(), /Manager coverage status unavailable/);
      assert.doesNotMatch(rendered.text(), /Manager coverage for all/);
    } finally { rendered.cleanup(); }
  }
});

test('version-wide uncovered evidence from another session blocks false Ready in this session', async () => {
  const otherSessionPair = { stage: 'planning', property: 'motion_rhythm', relation: 'exception' };
  const { rendered } = await renderedWith({ managerCoverage: coverage({
    classified: true,
    acceptedLocalRecordCount: 1,
    listedSessionAcceptedRecordCount: 0,
    acceptedPairs: [otherSessionPair],
    listedSessionAcceptedPairs: [],
    coveredPairs: [],
    uncoveredPairs: [otherSessionPair],
    readiness: 'agent_update_required',
    reason: 'manager_quality_coverage_incomplete_training',
  }) });
  try {
    assert.match(rendered.text(), /version-wide result across all training sessions/);
    assert.match(rendered.text(), /Plan the treatment · motion rhythm · Exception/);
    assert.doesNotMatch(rendered.text(), /Manager coverage for all/);
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
