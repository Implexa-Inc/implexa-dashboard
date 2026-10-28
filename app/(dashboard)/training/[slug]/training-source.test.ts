import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { render, type Rendered } from '../../../../lib/test/render.ts';
import { deriveTrainingStages, formatTrainingTime, isManagerTrainingCoverage, isManagerTrainingRequirements, isTrainingSuccessorProjection, normalizeTrainingStages, previewMatches, requiredStagesForDecision, TRAINING_LOCAL_CONTRACT_VERSION, TRAINING_PROPERTY_CODES, TRAINING_RELATIONS, TRAINING_STAGE_ROUTING_VERSION } from '../../../../lib/training-local-ingress.ts';
import { questionsPage, validAnswerBody, answerReceipt } from '../../../../lib/trainer-questions.ts';

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

type DecisionState = 'draft' | 'accepted' | 'retired' | 'revoked';
function decision(state: DecisionState = 'draft', stages: string[] = ['preview', 'build', 'qa']) {
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

function source(state: DecisionState = 'draft', stages?: string[]) {
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

function optionalCoverage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const optional = { stage: 'build', property: 'internal_label_exclusion', relation: 'rejected' };
  const unsupported = { stage: 'preview', property: 'motion_rhythm', relation: 'accepted' };
  return coverage({
    contractVersion: 'manager-training-coverage.v2', acceptedLocalRecordCount: 3,
    acceptedPairs: [optional, planningPair, unsupported], listedSessionAcceptedPairs: [planningPair],
    optionalPairs: [optional], unsupportedPairs: [unsupported], uncoveredPairs: [optional, unsupported],
    ...overrides,
  });
}

function requirements(workflowVersionId = VERSION_A, overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'manager-reference-training-readiness.v1',
    scope: 'workflow_version_quality_references',
    workflowVersionId,
    classified: true,
    requiredPairs: [planningPair],
    fulfilledPairs: [planningPair],
    missingPairs: [],
    readiness: 'reference_training_ready',
    reason: null,
    ...overrides,
  };
}

function harness(options: {
  state?: DecisionState;
  previewImage?: string;
  localToken?: string | null;
  authorityResponse?: Record<string, unknown>;
  failRefreshAfterAuthority?: boolean;
  currentVersion?: string | null;
  failedDrafts?: Array<Record<string, unknown>>;
  pendingDecisions?: Array<Record<string, unknown>>;
  stages?: string[];
  managerCoverage?: Record<string, unknown>;
  managerTrainingRequirements?: Record<string, unknown> | null;
  successorSha?: string;
  successorBaseVersion?: string;
  successorCreatedBaseVersion?: string;
  successorParentSessionId?: string | null;
  includeCurrentSession?: boolean;
  predecessorTerminal?: boolean;
  predecessorCount?: number;
  successorProjection?: unknown;
  loseFirstSuccessorResponse?: boolean;
} = {}) {
  const calls: Call[] = [];
  let currentVersion = options.currentVersion === undefined ? VERSION_A : options.currentVersion;
  let decisionState = options.state || 'draft';
  let sessionTerminal = options.predecessorTerminal === true;
  let authorityAcknowledged = false;
  let lastAnnotated: any = null;
  let successorSelected = false;
  let successorCreateAttempts = 0;
  const bridge = {
    trainingLocalContractVersion: '2',
    trainingLocal: async (operation: string, unknownArgs: unknown) => {
      const args = (unknownArgs || {}) as Record<string, unknown>;
      calls.push({ operation, args });
      if (operation === 'home') {
        const projection = options.successorProjection === undefined ? {
          contractVersion: 'agent-training-successor-projection.v1',
          activeVersionId: currentVersion,
          eligiblePredecessor: currentVersion === VERSION_B ? { sessionId: SESSION, baseVersionId: VERSION_A, acceptedLocalRecordCount: options.predecessorCount ?? 1 } : null,
        } : options.successorProjection;
        return { ok: true, home: {
          agent: { name: 'Video craft', currentVersionId: currentVersion },
          recentSessions: [
            ...(options.includeCurrentSession ? [{ sessionId: NEW_SESSION, sourceMode: 'raw_input', terminal: false, agent: { baseVersionId: VERSION_B } }] : []),
            ...(currentVersion === VERSION_A ? [{ sessionId: SESSION, sourceMode: 'raw_input', terminal: false, agent: { baseVersionId: VERSION_A } }] : []),
          ],
          successorProjection: projection,
          managerTrainingRequirements: currentVersion
            ? (options.managerTrainingRequirements === undefined ? requirements(currentVersion) : options.managerTrainingRequirements)
            : null,
        } };
      }
      if (operation === 'scope') return { ok: true, scope: { agent: { name: 'Video craft', currentVersionId: currentVersion }, ...(args.sessionId ? { session: { sessionId: String(args.sessionId), baseVersionId: args.sessionId === NEW_SESSION ? (options.successorBaseVersion || currentVersion) : VERSION_A, parentSessionId: args.sessionId === NEW_SESSION ? (options.successorParentSessionId === undefined ? SESSION : options.successorParentSessionId) : null, terminal: args.sessionId === SESSION && sessionTerminal } } : {}) } };
      if (operation === 'create') {
        successorCreateAttempts += 1;
        if (options.loseFirstSuccessorResponse && successorCreateAttempts === 1) return { ok: false, reason: 'training_unavailable' };
        return {
          ok: true,
          sessionId: NEW_SESSION,
          baseVersionId: options.successorCreatedBaseVersion || currentVersion,
          parentSessionId: options.successorParentSessionId === undefined ? SESSION : options.successorParentSessionId,
        };
      }
      if (operation === 'select' && args.sessionId === NEW_SESSION) successorSelected = true;
      if (operation === 'list') {
        if (authorityAcknowledged && options.failRefreshAfterAuthority) return { ok: false, reason: 'training_local_unavailable' };
        const next = source('draft', options.stages);
        if (options.successorSha) next.metadata.sha256 = options.successorSha;
        const listedVersion = args.sessionId === NEW_SESSION ? currentVersion : VERSION_A;
        const current: any = source(decisionState, options.stages);
        if (lastAnnotated) { current.decisions[0].decision = lastAnnotated.decision;
          current.decisions[0].content.derivatives = [{ sha256: createHash('sha256').update(Buffer.from((options.previewImage || PNG).split(',')[1], 'base64')).digest('hex') }]; }
        return {
          ok: true,
          sources: args.sessionId === NEW_SESSION ? (successorSelected ? [{ ...next, decisions: [] }] : []) : [{...current, token: options.localToken === undefined ? TOKEN : options.localToken}],
          failedDrafts: options.failedDrafts || [],
          pendingDecisions: options.pendingDecisions || [],
          managerCoverage: options.managerCoverage,
          managerTrainingRequirements: listedVersion
            ? (options.managerTrainingRequirements === undefined ? requirements(listedVersion) : options.managerTrainingRequirements)
            : null,
        };
      }
      if (operation === 'decisionPreview') return { ok: true, image: PNG, recordId: RECORD, recordDigest: DIGEST };
      if (operation === 'annotate') { lastAnnotated = args; return { ok: true, recordId: RECORD, recordDigest: DIGEST, state: 'draft' }; }
      if (operation === 'accept') { decisionState = 'accepted'; return { ok: true, recordId: RECORD, recordDigest: DIGEST, state: 'accepted' }; }
      if (operation === 'retire' || operation === 'revoke') {
        decisionState = operation === 'retire' ? 'retired' : 'revoked';
        authorityAcknowledged = true;
        return options.authorityResponse || { ok: true, recordId: RECORD, recordDigest: DIGEST, state: decisionState };
      }
      return { ok: true, image: options.previewImage || PNG };
    },
  };
  return { bridge, calls, setCurrentVersion: (value: string | null) => { currentVersion = value; }, setSessionTerminal: (value: boolean) => { sessionTerminal = value; } };
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

const QUESTION = '77777777-7777-4777-8777-777777777777';
function questionRow(patch: Record<string, unknown> = {}) {
  return { id: QUESTION, receiptDigest: 'd'.repeat(64), createdAt: '2026-10-27T00:00:00.000Z',
    questionId: 'visual-choice', question: 'Which visual treatment fits this comparison?', sceneElement: 'comparison-scene',
    property: 'layout_variety', stage: 'planning', questionVersionId: VERSION_A,
    runId: '88888888-8888-4888-8888-888888888888', runState: 'failed', runStatus: 'failed', outcome: 'no_match',
    returnedReferenceIds: [], recordedEvidence: false, fallback: null, recurrenceCount: 1, teachings: [], ...patch };
}
function questionPage(items = [questionRow()], patch: Record<string, unknown> = {}) {
  return { ok: true, contractVersion: 'trainer-questions.v1', agentFamilyId: SOURCE_ID, activeVersionId: VERSION_A,
    items, nextCursor: null, ...patch };
}
type QuestionCall = { url: string; body?: Record<string, unknown>; key?: string | null };
function questionTransport(rendered: Rendered, bridgeCalls: Call[], { firstFailure = false, page = questionPage() } = {}) {
  const calls: QuestionCall[] = []; let linked = false; let attempts = 0;
  rendered.window.fetch = (async (input: string, init?: RequestInit) => {
    const call: QuestionCall = { url: String(input) }; calls.push(call);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); call.body = body; call.key = new Headers(init.headers).get('Idempotency-Key'); attempts++;
      if (firstFailure && attempts === 1) return { ok: false, json: async () => ({ ok: false, reason: 'trainer_questions_unavailable' }) };
      linked = true;
      return { ok: true, json: async () => ({ ok: true, contractVersion: 'trainer-question-answer.v1', questionReceiptId: body.questionReceiptId,
        recordId: body.recordId, recordDigest: body.expectedRecordDigest, targetVersionId: body.expectedActiveVersionId,
        teachingState: 'prepared', reason: null, linkReceiptId: SOURCE_ID, idempotent: attempts > 1 }) };
    }
    return { ok: true, json: async () => ({ ...page, items: page.items.map(q => ({ ...q,
      teachings: linked ? [{ sessionId: SESSION, recordId: RECORD, recordDigest: DIGEST,
        state: bridgeCalls.some(c => c.operation === 'accept') ? 'taught' : 'prepared', reason: null, targetVersionId: VERSION_A }] : q.teachings })) }) };
  }) as unknown as typeof rendered.window.fetch;
  return calls;
}
async function prepareAnswer(rendered: Rendered) {
  await rendered.click(rendered.getByText('Load recorded questions'));
  await rendered.click(rendered.document.querySelector('input[aria-label="Select question visual-choice"]')!);
  await setTextarea(rendered, rendered.getByText('Private answer').closest('label')!.querySelector('textarea')!, 'Use the visual example to explain the comparison clearly.');
  await rendered.click(rendered.getByText('Answer and prepare teaching'));
}

async function fillManualTeaching(rendered: Rendered) {
  for (const [label, text] of [['What was chosen', 'Spatial illustration'], ['Why this choice', 'The trainer prefers clear relationships'],
    ['Tool or process used', 'Arrange meaningful landmarks and connectors'], ['Desired visual, motion or layout behavior', 'Adapt the relationship to the new material']]) {
    await setTextarea(rendered, rendered.getByText(label).closest('label')!.querySelector('textarea')!, text);
  }
}

test('question wire rejects hidden raw answers, malformed identities and invented evidence', () => {
  assert.equal(questionsPage(questionPage()), true);
  for (const q of [questionRow({ rawAnswer: 'must not leak' }), questionRow({ id: [QUESTION] }),
    questionRow({ recordedEvidence: true }), questionRow({ fallback: 'invented' })]) assert.equal(questionsPage(questionPage([q])), false);
  assert.equal(questionsPage(questionPage([questionRow({ teachings: [{ sessionId: SESSION, recordId: RECORD, recordDigest: DIGEST, state: 'taught', reason: null, targetVersionId: VERSION_B }] })])), false);
  assert.equal(questionsPage(questionPage([questionRow({ outcome: 'matched', returnedReferenceIds: [] })])), true, 'owner-filtered IDs do not rewrite the historical outcome');
  const body = { questionReceiptId: QUESTION, questionReceiptDigest: 'd'.repeat(64), recordId: RECORD,
    expectedRecordDigest: DIGEST, rawAnswer: 'Private trainer answer.', expectedActiveVersionId: VERSION_A };
  assert.equal(validAnswerBody(body), true); assert.equal(validAnswerBody({ ...body, recordId: [RECORD] }), false);
  assert.equal(answerReceipt({ ok: true, contractVersion: 'trainer-question-answer.v1', questionReceiptId: QUESTION,
    recordId: SOURCE_ID, recordDigest: DIGEST, targetVersionId: VERSION_A, teachingState: 'prepared', reason: null,
    linkReceiptId: SOURCE_ID, idempotent: false }, body), false);
});

test('Training shows recorded matched and no-match consultations from failed and cancelled runs without inventing a gap', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    questionTransport(rendered, calls, { page: questionPage([questionRow(), questionRow({ id: SOURCE_ID,
      questionId: 'second-choice', question: 'How should this other scene read?', outcome: 'matched', returnedReferenceIds: [RECORD],
      questionVersionId: VERSION_B, runState: 'cancelled', runStatus: 'cancelled' })]) });
    await rendered.click(rendered.getByText('Load recorded questions'));
    assert.match(rendered.text(), /References returned; usefulness and application are unverified/);
    assert.match(rendered.text(), /No selected guidance matched/);
    assert.match(rendered.text(), /failed/); assert.match(rendered.text(), /cancelled/);
    assert.match(rendered.text(), /question version 22222222/);
    assert.match(rendered.text(), /Fallback and linked frame evidence were not recorded/);
    assert.equal(calls.some(c => c.operation === 'preview' || c.operation === 'annotate'), false);
  } finally { rendered.cleanup(); }
});

test('an answered question becomes an actual evidence draft link, not automatic admission or selected-learning proof', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    const requests = questionTransport(rendered, calls);
    await prepareAnswer(rendered);
    assert.match(rendered.text(), /Worker-visible draft guidance/);
    assert.equal(calls.some(c => c.operation === 'annotate' || c.operation === 'accept'), false);
    await rendered.click(rendered.getByText('Annotate source'));
    await rendered.click(rendered.getByText('Preview this exact frame'));
    await fillManualTeaching(rendered);
    await rendered.click(rendered.getByText('Save decision draft'));
    const posted = requests.find(r => r.body)!;
    assert.equal(posted.body!.recordId, RECORD); assert.equal(posted.body!.questionReceiptId, QUESTION);
    assert.equal(posted.body!.rawAnswer, 'Use the visual example to explain the comparison clearly.');
    assert.equal(posted.key, `question-answer:${QUESTION}:${RECORD}`);
    assert.equal(calls.some(c => c.operation === 'accept'), false);
    assert.match(rendered.text(), /Prepared — review and accept/);
    await rendered.click(rendered.getByText('Review before accepting'));
    await rendered.click(rendered.getByText(/I reviewed this exact frame and decision/).closest('label')!.querySelector('input')!);
    await rendered.click(rendered.getByText('Accept this exact decision'));
    assert.match(rendered.text(), /Taught — currently eligible, not proof of selection or application/);
  } finally { rendered.cleanup(); }
});

test('failed answer linking retries the saved teaching identity without another evidence draft', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    const requests = questionTransport(rendered, calls, { firstFailure: true });
    await prepareAnswer(rendered); await rendered.click(rendered.getByText('Annotate source'));
    await rendered.click(rendered.getByText('Preview this exact frame')); await fillManualTeaching(rendered); await rendered.click(rendered.getByText('Save decision draft'));
    assert.match(rendered.text(), /evidence draft is preserved/i);
    await rendered.click(rendered.getByText('Retry answer links'));
    const posts = requests.filter(r => r.body); assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, posts[1].body); assert.equal(posts[0].key, posts[1].key);
    assert.equal(calls.filter(c => c.operation === 'annotate').length, 1);
    assert.match(rendered.text(), /Prepared — review and accept/);
  } finally { rendered.cleanup(); }
});

test('a fresh Training page can link the same existing draft to several recorded questions without reauthoring it', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    const requests = questionTransport(rendered, calls, { page: questionPage([questionRow(), questionRow({ id: SOURCE_ID,
      questionId: 'related-choice', question: 'How should the related comparison be shown?', recurrenceCount: 2 })]) });
    await prepareAnswer(rendered);
    await rendered.click(rendered.document.querySelector('input[aria-label="Select question related-choice"]')!);
    await rendered.click(rendered.getByText('Answer and prepare teaching'));
    const select = rendered.getByText('Or link an existing teaching that already expresses this answer').closest('label')!.querySelector('select')!;
    await setSelect(rendered, select, RECORD); await rendered.click(rendered.getByText('Link answer to selected teaching'));
    assert.equal(calls.some(c => c.operation === 'annotate' || c.operation === 'accept' || c.operation === 'preview'), false);
    const posts = requests.filter(r => r.body); assert.equal(posts.length, 2);
    assert.deepEqual(posts.map(r => r.body!.recordId), [RECORD, RECORD]);
    assert.deepEqual(posts.map(r => r.key), [`question-answer:${QUESTION}:${RECORD}`, `question-answer:${SOURCE_ID}:${RECORD}`]);
  } finally { rendered.cleanup(); }
});

test('recorded questions use bounded keyset pagination and retain loaded rows when the next page is unavailable', async () => {
  const { rendered } = await renderedWith(); const urls: string[] = []; let requests = 0;
  const cursor = { createdAt: '2026-10-26T00:00:00.000Z', id: QUESTION };
  try {
    rendered.window.fetch = (async (input: string) => {
      urls.push(String(input)); requests++;
      if (requests === 3) return { ok: false, json: async () => ({ ok: false }) };
      if (requests === 4) return { ok: true, json: async () => questionPage([questionRow({ question: 'New-version row must not mix into this page.' })], { activeVersionId: VERSION_B }) };
      return { ok: true, json: async () => requests === 1 ? questionPage([questionRow()], { nextCursor: cursor })
        : questionPage([questionRow({ id: SOURCE_ID, questionId: 'older-question', question: 'An earlier recorded question.' })], { nextCursor: cursor }) };
    }) as unknown as typeof rendered.window.fetch;
    await rendered.click(rendered.getByText('Load recorded questions'));
    await rendered.click(rendered.getByText('Load more recorded questions'));
    const second = new URL(urls[1], 'https://dashboard.test');
    assert.equal(second.searchParams.get('limit'), '20');
    assert.equal(second.searchParams.get('afterCreatedAt'), cursor.createdAt); assert.equal(second.searchParams.get('afterId'), cursor.id);
    assert.match(rendered.text(), /Which visual treatment fits this comparison/); assert.match(rendered.text(), /An earlier recorded question/);
    await rendered.click(rendered.getByText('Load more recorded questions'));
    assert.match(rendered.text(), /This does not mean no questions were asked/);
    assert.match(rendered.text(), /An earlier recorded question/);
    await rendered.click(rendered.getByText('Load more recorded questions'));
    assert.match(rendered.text(), /Refresh recorded questions before continuing/);
    assert.doesNotMatch(rendered.text(), /New-version row must not mix/);
    assert.match(rendered.text(), /An earlier recorded question/);
  } finally { rendered.cleanup(); }
});

test('timecodes and preview authority are exact to the source token and millisecond', () => {
  assert.equal(TRAINING_LOCAL_CONTRACT_VERSION, '2');
  assert.equal(TRAINING_STAGE_ROUTING_VERSION, 'manager-training-applicability.v1');
  assert.equal(TRAINING_PROPERTY_CODES.length, 15);
  assert.deepEqual(TRAINING_RELATIONS, ['accepted', 'rejected', 'contrast', 'exception']);
  assert.deepEqual(deriveTrainingStages('motion_rhythm'), ['planning', 'build', 'preview', 'qa', 'revision']);
  assert.deepEqual(deriveTrainingStages('layout_variety'), ['planning', 'scene_contract', 'build', 'preview', 'qa', 'revision']);
  assert.deepEqual(normalizeTrainingStages(['planning', 'unknown', 'planning', 'qa']), ['planning', 'qa']);
  assert.deepEqual(normalizeTrainingStages(['qa', 'planning']), ['planning', 'qa'], 'equivalent stage sets have one canonical wire order');
  assert.equal(formatTrainingTime(83_125), '01:23.125');
  assert.equal(formatTrainingTime(3_683_009), '01:01:23.009');
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, TOKEN, 1000), true);
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, TOKEN, 1001), false, 'a late old frame cannot authorize the new timestamp');
  assert.equal(previewMatches({ token: TOKEN, timeMs: 1000 }, 'other-token', 1000), false, 'a frame cannot cross sources');
  assert.equal(isTrainingSuccessorProjection({ contractVersion: 'agent-training-successor-projection.v1', activeVersionId: VERSION_B, eligiblePredecessor: { sessionId: SESSION, baseVersionId: VERSION_A, acceptedLocalRecordCount: 1 } }, VERSION_B), true);
  assert.equal(isTrainingSuccessorProjection({ contractVersion: 'agent-training-successor-projection.v1', activeVersionId: VERSION_A, eligiblePredecessor: null }, VERSION_B), false, 'a stale server projection cannot authorize a transition');
  assert.equal(isTrainingSuccessorProjection({ contractVersion: 'agent-training-successor-projection.v1', activeVersionId: VERSION_B, eligiblePredecessor: { sessionId: SESSION, baseVersionId: VERSION_A, acceptedLocalRecordCount: 1, extra: true } }, VERSION_B), false, 'the predecessor wire is exact');
  assert.equal(isTrainingSuccessorProjection({ contractVersion: 'agent-training-successor-projection.v1', activeVersionId: VERSION_B, eligiblePredecessor: { sessionId: SESSION, baseVersionId: VERSION_B, acceptedLocalRecordCount: 1 } }, VERSION_B), false, 'active-version evidence is never its own predecessor');
  assert.equal(isTrainingSuccessorProjection({ contractVersion: 'agent-training-successor-projection.v1', activeVersionId: VERSION_B, eligiblePredecessor: { sessionId: SESSION, baseVersionId: VERSION_A, acceptedLocalRecordCount: 0 } }, VERSION_B), false, 'an empty session is not adoption evidence');
  assert.equal(isManagerTrainingRequirements(requirements(), VERSION_A), true);
  assert.equal(isManagerTrainingRequirements(requirements(VERSION_B), VERSION_A), false, 'requirements cannot cross immutable versions');
  assert.equal(isManagerTrainingRequirements(requirements(VERSION_A, { missingPairs: [planningPair], readiness: 'coach_reference_training_required', reason: 'manager_required_reference_training_missing' }), VERSION_A), false, 'a pair cannot be both fulfilled and missing');
  assert.equal(isManagerTrainingRequirements(requirements(VERSION_A, { fulfilledPairs: [], missingPairs: [planningPair], readiness: 'coach_reference_training_required', reason: 'manager_required_reference_training_missing' }), VERSION_A), true);
  assert.equal(isManagerTrainingCoverage(coverage(), VERSION_A), true);
  assert.equal(isManagerTrainingCoverage({ ...coverage(), extra: true }, VERSION_A), false, 'coverage wire rejects unknown keys');
  assert.equal(isManagerTrainingCoverage({ ...coverage(), listedSessionAcceptedRecordCount: 2 }, VERSION_A), false, 'session evidence count cannot exceed version evidence count');
  assert.equal(isManagerTrainingCoverage({ ...coverage(), classified: false }, VERSION_A), false, 'ready coverage must be classified');
  assert.equal(isManagerTrainingCoverage({ ...coverage(), acceptedLocalRecordCount: 0, listedSessionAcceptedRecordCount: 0, listedSessionAcceptedPairs: [] }, VERSION_A), false, 'zero accepted records cannot carry invented accepted or covered routes');
  assert.equal(isManagerTrainingCoverage({ ...coverage(), acceptedPairs: [], listedSessionAcceptedPairs: [], coveredPairs: [] }, VERSION_A), false, 'positive accepted-record count must carry at least one accepted route');
  const inventedProperty = { ...planningPair, property: 'invented_property' };
  assert.equal(isManagerTrainingCoverage({ ...coverage(), acceptedPairs: [inventedProperty], listedSessionAcceptedPairs: [inventedProperty], coveredPairs: [inventedProperty] }, VERSION_A), false);
  const inventedRelation = { ...planningPair, relation: 'invented_relation' };
  assert.equal(isManagerTrainingCoverage({ ...coverage(), acceptedPairs: [inventedRelation], listedSessionAcceptedPairs: [inventedRelation], coveredPairs: [inventedRelation] }, VERSION_A), false);
  const secondPair = { ...planningPair, property: 'motion_rhythm' };
  const foreignPair = { ...planningPair, property: 'transition_quality' };
  assert.equal(isManagerTrainingCoverage({ ...coverage(), acceptedPairs: [planningPair, secondPair], listedSessionAcceptedPairs: [planningPair], coveredPairs: [planningPair, foreignPair] }, VERSION_A), false, 'covered and missing sets must exactly partition accepted routes');
  assert.deepEqual(requiredStagesForDecision(requirements() as never, 'layout_variety', 'contrast'), ['planning']);
  assert.deepEqual(requiredStagesForDecision(requirements() as never, 'motion_rhythm', 'accepted'), [], 'required stages are exact to both property and relation');
});

test('optional coverage has an exact disjoint partition without weakening historical coverage', () => {
  const valid = optionalCoverage();
  assert.equal(isManagerTrainingCoverage(valid, VERSION_A), true);
  const optional = valid.optionalPairs as unknown[];
  const unsupported = valid.unsupportedPairs as unknown[];
  for (const invalid of [
    { ...valid, optionalPairs: [] },
    { ...valid, unsupportedPairs: [...optional, ...unsupported] },
    { ...valid, coveredPairs: [...optional, planningPair] },
    { ...valid, optionalPairs: [...optional, ...optional] },
    { ...valid, unsupportedPairs: [] },
    { ...valid, unknown: true },
    { ...valid, classified: false },
    { ...valid, workflowVersionId: VERSION_B },
    { ...valid, contractVersion: 'manager-training-coverage.v1' },
  ]) assert.equal(isManagerTrainingCoverage(invalid, VERSION_A), false);
  assert.equal(isManagerTrainingCoverage(coverage({ uncoveredPairs: [planningPair], coveredPairs: [] }), VERSION_A), false,
    'a legacy ready response cannot acquire optional semantics');
});

test('optional taste stays distinct from unsupported training and from a missing mandatory reference', async () => {
  const ready = await renderedWith({ state: 'accepted', managerCoverage: optionalCoverage() });
  try {
    assert.match(ready.rendered.text(), /Private training routing available/);
    assert.match(ready.rendered.text(), /internal label exclusion.*Optional taste/);
    assert.match(ready.rendered.text(), /motion rhythm.*Unsupported/);
    assert.match(ready.rendered.text(), /eligibility does not mean an example was selected or applied/);
    assert.doesNotMatch(ready.rendered.text(), /classifies all|Agent update required|coverage status unavailable/);
  } finally { ready.rendered.cleanup(); }
  const missing = await renderedWith({ state: 'accepted', managerCoverage: optionalCoverage(),
    managerTrainingRequirements: requirements(VERSION_A, { fulfilledPairs: [], missingPairs: [planningPair],
      readiness: 'coach_reference_training_required', reason: 'manager_required_reference_training_missing' }),
  });
  try {
    assert.match(missing.rendered.text(), /reference training not ready/);
    assert.match(missing.rendered.text(), /still requires accepted visual-reference evidence/);
  } finally { missing.rendered.cleanup(); }
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

test('malformed or stale active-version training requirements fail closed before evidence is called ready', async () => {
  for (const managerTrainingRequirements of [null, requirements(VERSION_B), { ...requirements(), extra: true }]) {
    const { rendered } = await renderedWith({ managerTrainingRequirements });
    try {
      assert.match(rendered.text(), /required visual-reference training coverage|reference training readiness unavailable/i);
      assert.doesNotMatch(rendered.text(), /Manager reference training ready:/);
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
  const { rendered, calls, setCurrentVersion } = await renderedWith({ state: 'accepted', stages: ['planning', 'build', 'preview', 'qa'], managerCoverage: coverage() });
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
    assert.equal(create.args.parentSessionId, SESSION);
    assert.match(String(create.args.key), /^[a-f0-9-]{36}$/);
    assert.match(rendered.text(), /records below remain bound to 11111111/);
    assert.match(rendered.text(), /Re-add source SHA-256 bbbbbbbb/);
    assert.doesNotMatch(rendered.text(), /This immutable agent version has Manager coverage/, 'old-version readiness cannot transfer to the successor');
    assert.match(rendered.text(), /Manager coverage status unavailable/, 'a stale old-version projection fails closed until new-version records and coverage exist');
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

test('an adopted ready active version does not ask the coach to recreate immutable predecessor evidence', async () => {
  const { rendered } = await renderedWith({
    currentVersion: VERSION_B,
    state: 'accepted',
    stages: ['planning'],
    managerTrainingRequirements: requirements(VERSION_B),
  });
  try {
    assert.match(rendered.text(), /Active-version Manager training is ready/);
    assert.match(rendered.text(), /active version 22222222 can select the same evidence through explicit immutable adoption receipts/i);
    assert.match(rendered.text(), /No new successor training session is required to run this Agent/);
    assert.doesNotMatch(rendered.text(), /active version is 22222222 and cannot select those records/i);
    assert.equal(rendered.queryByText('Start successor training session'), null);
    assert.doesNotMatch(rendered.text(), /Manager reference training readiness unavailable/);
  } finally { rendered.cleanup(); }
});

test('version transition is restart-durable and retains explicit parent lineage', async () => {
  const { rendered, calls } = await renderedWith({ currentVersion: VERSION_B, state: 'accepted', stages: ['planning', 'build', 'preview', 'qa'], managerCoverage: coverage() });
  try {
    assert.match(rendered.text(), /Active version: 22222222 · Session version: 11111111/);
    assert.match(rendered.text(), /Move reviewed evidence to the active version explicitly/);
    assert.equal((rendered.getByText('Add training source') as HTMLButtonElement).disabled, true);
    await rendered.click(rendered.getByText(/I understand this creates new evidence records/).closest('label')!.querySelector('input')!);
    await rendered.click(rendered.getByText('Start successor training session'));
    const create = calls.find((call) => call.operation === 'create')!;
    assert.deepEqual(create.args.parentSessionId, SESSION);
    assert.match(rendered.text(), /records below remain bound to 11111111/);
    assert.doesNotMatch(rendered.text(), /This immutable agent version has Manager coverage/);
  } finally { rendered.cleanup(); }
});

test('fresh reload discovers a server-owned accepted predecessor outside the capped recent-session feed', async () => {
  const { rendered, calls } = await renderedWith({ currentVersion: VERSION_B, state: 'accepted', predecessorTerminal: true });
  try {
    assert.match(rendered.text(), /Active version: 22222222 · Session version: 11111111/);
    assert.match(rendered.text(), /Move reviewed evidence to the active version explicitly/);
    assert.equal(calls.some((call) => call.operation === 'scope' && call.args.sessionId === SESSION), true);
    assert.equal(calls.some((call) => call.operation === 'list' && call.args.sessionId === SESSION), true);
    assert.equal(calls.some((call) => call.operation === 'create'), false);
  } finally { rendered.cleanup(); }
});

test('lost successor response retries with the same idempotency key and exact predecessor', async () => {
  const { rendered, calls } = await renderedWith({ currentVersion: VERSION_B, state: 'accepted', loseFirstSuccessorResponse: true });
  try {
    await rendered.click(rendered.getByText(/I understand this creates new evidence records/).closest('label')!.querySelector('input')!);
    await rendered.click(rendered.getByText('Start successor training session'));
    assert.match(rendered.text(), /training unavailable/i);
    await rendered.click(rendered.getByText('Start successor training session'));
    const creates = calls.filter((call) => call.operation === 'create');
    assert.equal(creates.length, 2);
    assert.equal(creates[0].args.key, creates[1].args.key);
    assert.equal(creates[0].args.parentSessionId, SESSION);
    assert.equal(creates[1].args.parentSessionId, SESSION);
    assert.match(rendered.text(), /Recreate reviewed decisions for 22222222/);
  } finally { rendered.cleanup(); }
});

test('missing, stale, or inconsistent successor discovery never becomes an adoption prompt', async () => {
  for (const options of [
    { currentVersion: VERSION_B, successorProjection: null },
    { currentVersion: VERSION_B, successorProjection: { contractVersion: 'agent-training-successor-projection.v0', activeVersionId: VERSION_B, eligiblePredecessor: null } },
    { currentVersion: VERSION_B, successorProjection: { contractVersion: 'agent-training-successor-projection.v1', activeVersionId: VERSION_A, eligiblePredecessor: null } },
    { currentVersion: VERSION_B, predecessorCount: 2 },
  ]) {
    const { rendered, calls } = await renderedWith(options);
    try {
      assert.match(rendered.text(), /version-transition evidence projection could not be verified|training successor projection unavailable/i);
      assert.doesNotMatch(rendered.text(), /Start successor training session/);
      assert.equal(calls.some((call) => call.operation === 'create'), false);
    } finally { rendered.cleanup(); }
  }
});

test('reload discovers accepted predecessor evidence behind an existing linked active-version session', async () => {
  const { rendered, calls } = await renderedWith({ currentVersion: VERSION_B, state: 'accepted', includeCurrentSession: true });
  try {
    assert.match(rendered.text(), /Active version: 22222222 · Session version: 22222222/);
    assert.doesNotMatch(rendered.text(), /Move reviewed evidence to the active version explicitly/);
    assert.match(rendered.text(), /Recreate reviewed decisions for 22222222/);
    assert.match(rendered.text(), /records below remain bound to 11111111/);
    assert.match(rendered.text(), /Re-add source SHA-256 bbbbbbbb/);
    assert.equal(calls.filter((call) => call.operation === 'scope' && call.args.sessionId === SESSION).length, 1);
    assert.equal(calls.filter((call) => call.operation === 'list' && call.args.sessionId === SESSION).length, 1);
    assert.equal(calls.some((call) => call.operation === 'create'), false, 'the already linked active session is reused');
  } finally { rendered.cleanup(); }
});

test('reload never treats an unrelated active-version session as the evidence successor', async () => {
  const { rendered } = await renderedWith({ currentVersion: VERSION_B, state: 'accepted', includeCurrentSession: true, successorParentSessionId: null });
  try {
    assert.match(rendered.text(), /Active version: 22222222 · Session version: 11111111/);
    assert.match(rendered.text(), /Move reviewed evidence to the active version explicitly/);
    assert.doesNotMatch(rendered.text(), /Recreate reviewed decisions/);
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

  const unbound = await renderedWith({ state: 'accepted', successorParentSessionId: null });
  try {
    unbound.setCurrentVersion(VERSION_B);
    await unbound.rendered.click(unbound.rendered.getByText('Review accepted evidence'));
    await unbound.rendered.click(unbound.rendered.getByText(/I understand this creates new evidence records/).closest('label')!.querySelector('input')!);
    await unbound.rendered.click(unbound.rendered.getByText('Start successor training session'));
    assert.match(unbound.rendered.text(), /could not prove the successor session is linked/i);
    assert.equal(unbound.calls.some((call) => call.operation === 'select' || call.operation === 'annotate'), false);
  } finally { unbound.rendered.cleanup(); }

  const staleCreate = await renderedWith({ state: 'accepted', successorCreatedBaseVersion: VERSION_A });
  try {
    staleCreate.setCurrentVersion(VERSION_B);
    await staleCreate.rendered.click(staleCreate.rendered.getByText('Review accepted evidence'));
    await staleCreate.rendered.click(staleCreate.rendered.getByText(/I understand this creates new evidence records/).closest('label')!.querySelector('input')!);
    await staleCreate.rendered.click(staleCreate.rendered.getByText('Start successor training session'));
    assert.match(staleCreate.rendered.text(), /could not prove the successor session is linked/i);
    assert.equal(staleCreate.calls.some((call) => call.operation === 'select' || call.operation === 'annotate'), false);
  } finally { staleCreate.rendered.cleanup(); }
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
    assert.equal((annotation.args.content as { applicability: { priority: number } }).applicability.priority, 50);
    assert.deepEqual(JSON.parse(JSON.stringify((annotation.args.content as { applicability: { stages: string[] } }).applicability.stages)), ['planning', 'build', 'preview', 'qa', 'revision']);
    assert.equal((rendered.getByText('Save decision draft') as HTMLButtonElement).disabled, true);
    assert.ok(Array.from(rendered.document.querySelectorAll('textarea')).every((textarea) => textarea.value === ''));
    assert.equal(rendered.document.querySelector('img[alt^="Training source frame"]'), null, 'consumed preview no longer authorizes another save');
  } finally { rendered.cleanup(); }
});

test('explicit preference saves the exact bounded priority and resets for the next draft', async () => {
  for (const value of ['0', '60', '100']) {
    const { rendered, calls } = await renderedWith();
    try {
      await rendered.click(rendered.getByText('Annotate source'));
      await rendered.click(rendered.getByText('Preview this exact frame'));
      for (const [index, textarea] of Array.from(rendered.document.querySelectorAll('textarea')).entries()) await setTextarea(rendered, textarea, `answer ${index}`);
      const input = rendered.getByText('Selection priority').querySelector('input')!;
      assert.equal((input as HTMLInputElement).value, '50');
      await setInput(rendered, input, value);
      await rendered.click(rendered.getByText('Save decision draft'));
      const annotation = calls.find((item) => item.operation === 'annotate')!;
      const applicability = (annotation.args.content as { applicability: { priority: number; stages: string[] } }).applicability;
      assert.equal(applicability.priority, Number(value));
      assert.deepEqual(JSON.parse(JSON.stringify(applicability.stages)), deriveTrainingStages('motion_rhythm'));
      assert.equal(calls.some((call) => call.operation === 'accept' || call.operation === 'revoke'), false);
      assert.equal((input as HTMLInputElement).value, '50');
    } finally { rendered.cleanup(); }
  }
});

test('empty, fractional and out-of-range priorities cannot create a decision', async () => {
  const { rendered, calls } = await renderedWith();
  try {
    await rendered.click(rendered.getByText('Annotate source'));
    await rendered.click(rendered.getByText('Preview this exact frame'));
    for (const [index, textarea] of Array.from(rendered.document.querySelectorAll('textarea')).entries()) await setTextarea(rendered, textarea, `answer ${index}`);
    const input = rendered.getByText('Selection priority').querySelector('input')!;
    for (const value of ['', '-1', '101', '1.5', '1e2']) {
      await setInput(rendered, input, value);
      assert.equal((rendered.getByText('Save decision draft') as HTMLButtonElement).disabled, true, value);
      assert.equal(input.getAttribute('aria-invalid'), 'true');
      await rendered.click(rendered.getByText('Save decision draft'));
    }
    assert.equal(calls.some((call) => call.operation === 'annotate'), false);
    await setInput(rendered, input, '60');
    assert.equal((rendered.getByText('Save decision draft') as HTMLButtonElement).disabled, false);
  } finally { rendered.cleanup(); }
});

test('priority changes get a fresh draft key while saved review and acceptance keep the original identity', async () => {
  const h = harness();
  const original = h.bridge.trainingLocal;
  h.bridge.trainingLocal = async (operation, args) => {
    if (operation === 'annotate') { h.calls.push({ operation, args: args as Record<string, unknown> }); return { ok: false, reason: 'training_network_unavailable' }; }
    const result = await original(operation, args);
    if (operation === 'list' && result.sources?.[0]) Object.assign(result.sources[0].decisions[0].content.applicability, { priority: 75 });
    return result;
  };
  const rendered = await render('../training/[slug]/training-source.tsx', { slug: 'video-craft' }, { bridge: h.bridge });
  try {
    await rendered.click(rendered.getByText('Review before accepting'));
    assert.match(rendered.text(), /Selection priority: 75/);
    await rendered.click(rendered.getByText('Close evidence review'));
    await rendered.click(rendered.getByText('Annotate source'));
    await rendered.click(rendered.getByText('Preview this exact frame'));
    for (const [index, textarea] of Array.from(rendered.document.querySelectorAll('textarea')).entries()) await setTextarea(rendered, textarea, `answer ${index}`);
    await rendered.click(rendered.getByText('Save decision draft'));
    await setInput(rendered, rendered.getByText('Selection priority').querySelector('input')!, '60');
    await rendered.click(rendered.getByText('Save decision draft'));
    const annotations = h.calls.filter((call) => call.operation === 'annotate');
    assert.equal(annotations.length, 2);
    assert.notEqual(annotations[0].args.idempotencyKey, annotations[1].args.idempotencyKey);
    assert.equal(h.calls.some((call) => call.operation === 'accept' || call.operation === 'revoke'), false);
    await rendered.click(rendered.getByText('Review before accepting'));
    assert.match(rendered.text(), /Selection priority: 75/);
    await rendered.click(rendered.getByText(/I reviewed this exact frame/).closest('label')!.querySelector('input')!);
    await rendered.click(rendered.getByText('Accept this exact decision'));
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find((call) => call.operation === 'accept')!.args)), { token: TOKEN, recordId: RECORD, expectedDigest: DIGEST });
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
    assert.match(ready.rendered.text(), /classifies all 1 accepted stage-scoped evidence routes across all training sessions/);
    assert.match(ready.rendered.text(), /Manager reference training ready: all 1 critical request-admission visual-reference routes/);
    assert.match(ready.rendered.text(), /first launch verifies all declared references/);
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
      assert.doesNotMatch(rendered.text(), /classifies all/);
    } finally { rendered.cleanup(); }
  }
});

test('an impossible zero-record ready projection cannot create green Manager readiness', async () => {
  const impossible = coverage({
    acceptedLocalRecordCount: 0,
    listedSessionAcceptedRecordCount: 0,
    listedSessionAcceptedPairs: [],
  });
  const { rendered } = await renderedWith({ state: 'draft', managerCoverage: impossible });
  try {
    assert.doesNotMatch(rendered.text(), /classifies all/);
    assert.doesNotMatch(rendered.text(), /Manager reference training ready:/);
  } finally { rendered.cleanup(); }
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
    assert.doesNotMatch(rendered.text(), /classifies all/);
  } finally { rendered.cleanup(); }
});

test('accepted evidence remains visibly not ready until every server-required pair is fulfilled', async () => {
  const missing = requirements(VERSION_A, {
    fulfilledPairs: [],
    missingPairs: [planningPair],
    readiness: 'coach_reference_training_required',
    reason: 'manager_required_reference_training_missing',
  });
  const { rendered } = await renderedWith({ state: 'accepted', managerCoverage: coverage(), managerTrainingRequirements: missing });
  try {
    assert.match(rendered.text(), /Evidence accepted: 1 immutable decision/);
    assert.match(rendered.text(), /Evidence accepted — reference training not ready/);
    assert.match(rendered.text(), /Plan the treatment · layout variety · Contrastive example/);
    assert.doesNotMatch(rendered.text(), /Manager reference training ready:/);
  } finally { rendered.cleanup(); }
});

test('successor preserves prior stages and expands required routes only after explicit coach action', async () => {
  const requiredPairs = [
    { stage: 'asset_selection', property: 'layout_variety', relation: 'contrast' },
    { stage: 'build', property: 'layout_variety', relation: 'contrast' },
    { stage: 'planning', property: 'layout_variety', relation: 'contrast' },
    { stage: 'preview', property: 'layout_variety', relation: 'contrast' },
    { stage: 'qa', property: 'layout_variety', relation: 'contrast' },
    { stage: 'revision', property: 'layout_variety', relation: 'contrast' },
    { stage: 'scene_contract', property: 'layout_variety', relation: 'contrast' },
  ];
  const missingRequirements = requirements(VERSION_B, {
    requiredPairs,
    fulfilledPairs: [],
    missingPairs: requiredPairs,
    readiness: 'coach_reference_training_required',
    reason: 'manager_required_reference_training_missing',
  });
  const { rendered } = await renderedWith({
    currentVersion: VERSION_B,
    state: 'accepted',
    stages: ['build', 'preview', 'qa'],
    managerCoverage: coverage(),
    managerTrainingRequirements: missingRequirements,
  });
  try {
    await rendered.click(rendered.getByText(/I understand this creates new evidence records/).closest('label')!.querySelector('input')!);
    await rendered.click(rendered.getByText('Start successor training session'));
    await rendered.click(rendered.getByText(/I created this source and consent/).closest('label')!.querySelector('input')!);
    await rendered.click(rendered.getByText('Add training source'));
    await rendered.click(rendered.getByText('Prepare new-version successor draft'));

    assert.match(rendered.text(), /The predecessor stages were preserved exactly/);
    assert.match(rendered.text(), /Still missing: Plan the treatment, Design scene contracts, Select assets, Revise from feedback/);
    const stageChecked = (label: string) => (rendered.getByText(label).closest('label')!.querySelector('input') as HTMLInputElement).checked;
    assert.equal(stageChecked('Build the composition'), true);
    assert.equal(stageChecked('Plan the treatment'), false, 'the UI never silently widens accepted evidence');
    assert.equal(stageChecked('Select assets'), false);

    await rendered.click(rendered.getByText('Add required stages to this successor draft'));
    assert.equal(stageChecked('Plan the treatment'), true);
    assert.equal(stageChecked('Design scene contracts'), true);
    assert.equal(stageChecked('Select assets'), true);
    assert.equal(stageChecked('Revise from feedback'), true);
    assert.match(rendered.text(), /All required stages are now explicitly selected/);
  } finally { rendered.cleanup(); }
});

test('accepted teaching has separate confirmed retirement and immediate permission withdrawal', async () => {
  const { rendered, calls } = await renderedWith({ state: 'accepted' });
  try {
    await rendered.click(rendered.getByText('Manage teaching'));
    assert.equal((rendered.getByText('Stop using in new runs') as HTMLButtonElement).disabled, true);
    assert.equal((rendered.getByText('Withdraw permission now') as HTMLButtonElement).disabled, true);
    assert.match(rendered.text(), /future run may need replacement training/);
    assert.match(rendered.text(), /already disclosed material cannot be recalled/);
    assert.equal(calls.some(item => item.operation === 'decisionPreview'), false);
    await rendered.click(rendered.getByText(/Stop selecting this teaching for new runs/).closest('label')!.querySelector('input')!);
    assert.equal((rendered.getByText('Withdraw permission now') as HTMLButtonElement).disabled, true, 'retirement confirmation never confirms privacy withdrawal');
    await rendered.click(rendered.getByText('Stop using in new runs'));
    const retired = calls.find(item => item.operation === 'retire')!;
    assert.deepEqual(JSON.parse(JSON.stringify(retired.args)), { sessionId: SESSION, recordId: RECORD, expectedDigest: DIGEST });
    await rendered.click(rendered.getByText('Manage teaching'));
    assert.equal(rendered.queryByText('Stop using in new runs'), null, 'retirement cannot silently reactivate itself');
    await rendered.click(rendered.getByText(/Withdraw permission for further use now/).closest('label')!.querySelector('input')!);
    await rendered.click(rendered.getByText('Withdraw permission now'));
    const call = calls.find((item) => item.operation === 'revoke')!;
    assert.deepEqual(JSON.parse(JSON.stringify(call.args)), { sessionId: SESSION, recordId: RECORD, expectedDigest: DIGEST });
    assert.equal(rendered.queryByText('Manage teaching'), null, 'revoked state takes precedence over retirement');
  } finally { rendered.cleanup(); }
});

test('authority reductions work without local evidence, preview, current version or an open session', async () => {
  for (const operation of ['retire', 'revoke'] as const) {
    const h = await renderedWith({ state: operation === 'retire' ? 'accepted' : 'retired', localToken: null });
    try {
      h.setCurrentVersion(VERSION_B); h.setSessionTerminal(true);
      const before = h.calls.length;
      await h.rendered.click(h.rendered.getByText('Manage teaching'));
      assert.equal(h.calls.length, before, 'managing server-listed authority does not require source access');
      const pattern = operation === 'retire' ? /Stop selecting this teaching for new runs/ : /Withdraw permission for further use now/;
      await h.rendered.click(h.rendered.getByText(pattern).closest('label')!.querySelector('input')!);
      await h.rendered.click(h.rendered.getByText(operation === 'retire' ? 'Stop using in new runs' : 'Withdraw permission now'));
      assert.deepEqual(h.calls.slice(before).map(item => item.operation), [operation, 'list']);
      assert.deepEqual(JSON.parse(JSON.stringify(h.calls[before].args)), { sessionId: SESSION, recordId: RECORD, expectedDigest: DIGEST });
    } finally { h.rendered.cleanup(); }
  }
});

test('authority response mismatches never show a successful retirement', async () => {
  const { rendered, calls } = await renderedWith({ state: 'accepted', authorityResponse: {
    ok: true, recordId: SOURCE_ID, recordDigest: DIGEST, state: 'retired',
  } });
  try {
    await rendered.click(rendered.getByText('Manage teaching'));
    await rendered.click(rendered.getByText(/Stop selecting this teaching for new runs/).closest('label')!.querySelector('input')!);
    const before = calls.length;
    await rendered.click(rendered.getByText('Stop using in new runs'));
    assert.match(rendered.text(), /authority change could not be verified/);
    assert.deepEqual(calls.slice(before).map(item => item.operation), ['retire']);
  } finally { rendered.cleanup(); }
});

test('acknowledged authority changes stay visible when local list refresh fails', async () => {
  for (const operation of ['retire', 'revoke'] as const) {
    const { rendered, calls } = await renderedWith({ state: 'accepted', failRefreshAfterAuthority: true });
    try {
      await rendered.click(rendered.getByText('Manage teaching'));
      const pattern = operation === 'retire' ? /Stop selecting this teaching for new runs/ : /Withdraw permission for further use now/;
      await rendered.click(rendered.getByText(pattern).closest('label')!.querySelector('input')!);
      await rendered.click(rendered.getByText(operation === 'retire' ? 'Stop using in new runs' : 'Withdraw permission now'));
      assert.match(rendered.text(), /change was applied, but the teaching list could not refresh/);
      assert.equal(rendered.queryByText('Review accepted evidence'), null);
      assert.equal(rendered.queryByText('Stop using in new runs'), null, 'the acknowledged action panel closes');
      assert.deepEqual(calls.slice(-2).map(item => item.operation), [operation, 'list']);
      if (operation === 'revoke') assert.equal(rendered.queryByText('Manage teaching'), null, 'withdrawn authority never remains actionable');
      else {
        await rendered.click(rendered.getByText('Manage teaching'));
        assert.match(rendered.text(), /teaching is stopped for new runs/);
        assert.equal(rendered.queryByText('Stop using in new runs'), null);
        assert.ok(rendered.getByText('Withdraw permission now'), 'retired teaching retains its privacy withdrawal path');
      }
    } finally { rendered.cleanup(); }
  }
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

const VALID_FRAME = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const SUGGESTION_FIELDS = { chosen: 'A central home links surrounding places.', why: 'The trainer prefers a spatial explanation.',
  process: 'Connect relevant places around a shared anchor.', desiredBehavior: 'Adapt the spatial relationship to the new input.' };
async function suggestionSetup() {
  const h = await renderedWith({ previewImage: VALID_FRAME });
  Object.defineProperty(h.rendered.window, 'crypto', { value: globalThis.crypto, configurable: true });
  Object.assign(h.rendered.window, { TextEncoder });
  questionTransport(h.rendered, h.calls);
  await prepareAnswer(h.rendered); await h.rendered.click(h.rendered.getByText('Annotate source'));
  await h.rendered.click(h.rendered.getByText('Preview this exact frame'));
  const fetchPrior = h.rendered.window.fetch;
  const requests: any[] = []; let complete: ((value: unknown) => void) | undefined;
  h.rendered.window.fetch = (async (url: string, init: RequestInit) => {
    if (!String(url).includes('/teaching-suggestion?')) return fetchPrior(url, init);
    const b = JSON.parse(String(init.body)); requests.push(b);
    const feedbackSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(b.feedback))), v => v.toString(16).padStart(2, '0')).join('');
    const { consent, feedback, image, ...binding } = b;
    const value = { requestId: '11111111-1111-4111-8111-111111111111',ok: true, contractVersion: 'training-teaching-suggestion.v2', model: 'claude-haiku-5-5',
      binding: { ...binding, feedbackSha256 }, status: 'suggested', fields: SUGGESTION_FIELDS, reason: '',
      sources: { chosen: 'observed_frame', why: 'trainer_preference', process: 'transferable_guidance', desiredBehavior: 'transferable_guidance' } };
    return await new Promise(resolve => { complete = (override: unknown = value) => resolve({ ok: true, json: async () => override }); });
  }) as typeof h.rendered.window.fetch;
  const flush = async () => { await h.rendered.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); };
  const start = async () => {
    await h.rendered.click(h.rendered.getByText(/Send this frame, the recorded question/).closest('label')!.querySelector('input')!);
    await h.rendered.click(h.rendered.getByText('Suggest teaching from this frame')); await flush();
  };
  return { ...h, requests, start, flush, finish: async (override?: unknown) => { await h.rendered.act(() => complete!(override)); await flush(); } };
}

test('suggestion is per-request opt-in, uses the exact frame and answer, and only fills fields after explicit use', async () => {
  const h = await suggestionSetup(); const r = h.rendered;
  try {
    assert.equal((r.getByText('Suggest teaching from this frame') as HTMLButtonElement).disabled, true);
    assert.equal(h.requests.length, 0); assert.equal(r.document.querySelector<HTMLTextAreaElement>('textarea[maxlength="400"]')!.value, '');
    await h.start(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].image, VALID_FRAME);
    assert.equal(h.requests[0].feedback, 'Use the visual example to explain the comparison clearly.'); assert.equal(h.requests[0].questionReceiptId, QUESTION);
    await h.finish(); assert.match(r.text(), /Observed frame/); assert.match(r.text(), /Trainer preference/); assert.match(r.text(), /Transferable guidance/);
    assert.equal(r.getByText('What was chosen').closest('label')!.querySelector('textarea')!.value, '');
    assert.equal(h.calls.some(c => c.operation === 'annotate' || c.operation === 'accept'), false);
    await r.click(r.getByText('Use this suggestion in editable fields'));
    assert.equal(r.getByText('What was chosen').closest('label')!.querySelector('textarea')!.value, SUGGESTION_FIELDS.chosen);
    assert.equal(h.calls.some(c => c.operation === 'annotate' || c.operation === 'accept'), false);
    assert.equal((r.getByText(/Send this frame, the recorded question/).closest('label')!.querySelector('input') as HTMLInputElement).checked, false);
  } finally { r.cleanup(); }
});

test('a late suggestion never overwrites a trainer edit or becomes applicable to a different frame', async () => {
  for (const change of ['text', 'frame', 'version']) {
    const h = await suggestionSetup(); const r = h.rendered;
    try {
      await h.start();
      if (change === 'text') await setTextarea(r, r.getByText('What was chosen').closest('label')!.querySelector('textarea')!, 'My own edited teaching');
      if (change === 'frame') await setInput(r, r.getByText('Exact timestamp in milliseconds').closest('label')!.querySelector('input')!, '100');
      if (change === 'version') h.setCurrentVersion(VERSION_B);
      await h.finish();
      if (change === 'version') await r.click(r.getByText('Use this suggestion in editable fields'));
      assert.equal((r.getByText('Use this suggestion in editable fields') as HTMLButtonElement).disabled, true);
      assert.match(r.text(), change === 'version' ? /version/i : /previous frame or edit/);
      if (change === 'text') assert.equal(r.getByText('What was chosen').closest('label')!.querySelector('textarea')!.value, 'My own edited teaching');
      assert.equal(h.calls.some(c => c.operation === 'annotate' || c.operation === 'accept'), false);
    } finally { r.cleanup(); }
  }
});

test('long raw answers are shown in full and are never copied with silent 400-character truncation', async () => {
  const { rendered: r, calls } = await renderedWith();
  try {
    questionTransport(r, calls); await r.click(r.getByText('Load recorded questions'));
    await r.click(r.document.querySelector('input[aria-label="Select question visual-choice"]')!);
    const text = 'A'.repeat(450) + ' preserve this exact ending.';
    await setTextarea(r, r.getByText('Private answer').closest('label')!.querySelector('textarea')!, text);
    await r.click(r.getByText('Answer and prepare teaching')); assert.ok(r.text().includes(text));
    await r.click(r.getByText('Annotate source'));
    for (const field of Array.from(r.document.querySelectorAll<HTMLTextAreaElement>('textarea[maxlength="400"]'))) assert.equal(field.value, '');
    assert.equal((r.getByText('Save decision draft') as HTMLButtonElement).disabled, true);
  } finally { r.cleanup(); }
});


test('edited suggestion saves through ordinary annotate and answer link, verifies its frame, and never auto-admits', async () => {
  const h = await suggestionSetup(); const r = h.rendered;
  try {
    await h.start(); await h.finish(); await r.click(r.getByText('Use this suggestion in editable fields'));
    await setTextarea(r, r.getByText('Why this choice').closest('label')!.querySelector('textarea')!, 'My reviewed reason, not an automatic rule.');
    await r.click(r.getByText('Save decision draft'));
    const saved = h.calls.filter(c => c.operation === 'annotate'); assert.equal(saved.length,1);
    assert.equal((saved[0].args.decision as any).chosen,SUGGESTION_FIELDS.chosen);
    assert.equal((saved[0].args.decision as any).why,'My reviewed reason, not an automatic rule.');
    assert.equal(h.calls.some(c=>c.operation==='accept'),false);
    assert.match(r.text(),/Saved teaching evidence matches the suggestion frame/);
    assert.match(r.text(),/model authorship is not durably recorded/);
  } finally { r.cleanup(); }
});

test('unavailable or malformed suggestion preserves the full answer and an existing manual draft', async () => {
  const h = await suggestionSetup(); const r = h.rendered;
  try {
    await setTextarea(r,r.getByText('What was chosen').closest('label')!.querySelector('textarea')!,'Keep my manual choice.');
    await h.start(); await h.finish({ok:false,reason:'unavailable'});
    assert.match(r.text(),/Your answer and manual draft are preserved/);
    assert.equal(r.getByText('What was chosen').closest('label')!.querySelector('textarea')!.value,'Keep my manual choice.');
    assert.match(r.text(),/Use the visual example to explain the comparison clearly/);
    assert.equal(r.queryByText('Use this suggestion in editable fields'),null);
    assert.equal(h.calls.some(c=>c.operation==='annotate'||c.operation==='accept'),false);
  } finally { r.cleanup(); }
});
