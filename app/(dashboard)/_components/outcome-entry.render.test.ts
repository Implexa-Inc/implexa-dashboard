import test from 'node:test';
import assert from 'node:assert/strict';
import { render, type Rendered } from '../../../lib/test/render.ts';

type FetchCall = { url: string; body: Record<string, unknown> };
const PRODUCTION_ID = '00000040-0000-4000-8000-000000000040';
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_ID = '77777777-7777-4777-8777-777777777777';
const INPUT_SESSION_ID = '88888888-8888-4888-8888-888888888888';
const DIGEST = 'a'.repeat(64);
const intent = {
  goal: 'Produce a final master from my approved sections.', quality: 'balanced', deadline_at: null,
  max_budget_credits: 100,
  consequential_action_ceiling: { max_provider_calls: 0, max_spend_minor: 0, currency: 'USD' },
  input_references: [],
};
const plan = {
  digest: DIGEST, contract_version: 'outcome-production-plan.v1', scorer_version: 'outcome-scorer-v1',
  weight_set_digest: 'b'.repeat(64), intent_digest: 'c'.repeat(64), quality: 'balanced', deadline_at: null,
  nodes: [{ ordinal: 0, role: 'produce_outcome', workflow_id: WORKFLOW_ID, workflow_version_id: VERSION_ID, slug: 'final-video-compositor', agent: { name: 'Final Video Compositor', task_key: 'video.final_master', task_label: 'Final Video Compositor', required_input_types: ['project_bundle'], output_types: ['video_master'] }, budget_credits: 100, max_duration_ms: 3600000, max_retries: 1, max_invocations: 1000 }],
  budget: { max_budget_credits: 100, allocations: [{ ordinal: 0, budget_credits: 100 }] }, unresolved_missing_assets: [],
  stop_conditions: { max_nodes: 2, sequential_only: true, on_child_failure: 'stop_with_typed_failure', on_budget_exhausted: 'stop_with_typed_failure', on_cancel: 'release_and_cancel_children' },
};
const planResponse = { ok: true, kind: 'plan', productionId: PRODUCTION_ID, intent, plan };

function stubFetch(rendered: Rendered, replies: Array<{ status: number; body: unknown }>) {
  const calls: FetchCall[] = [];
  (rendered.window as unknown as Record<string, unknown>).fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  return calls;
}

async function type(rendered: Rendered, element: Element, value: string) {
  const proto = element.tagName === 'TEXTAREA'
    ? (rendered.window as unknown as { HTMLTextAreaElement: { prototype: unknown } }).HTMLTextAreaElement.prototype
    : (rendered.window as unknown as { HTMLInputElement: { prototype: unknown } }).HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await rendered.act(() => { setter.call(element, value); element.dispatchEvent(new rendered.window.Event('input', { bubbles: true })); });
}

async function fillGoal(rendered: Rendered) {
  await type(rendered, rendered.document.getElementById('outcome-goal')!, 'Produce a final master from my approved sections.');
}

async function selectValue(rendered: Rendered, element: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    (rendered.window as unknown as { HTMLSelectElement: { prototype: unknown } }).HTMLSelectElement.prototype,
    'value',
  )!.set!;
  await rendered.act(() => {
    setter.call(element, value);
    element.dispatchEvent(new rendered.window.Event('change', { bubbles: true }));
  });
}

const planButton = (rendered: Rendered) => rendered.getByText('Plan this outcome') as HTMLButtonElement;

/** What the plan surface is currently offering, as booleans a failure can print. */
function planSurface(rendered: Rendered) {
  return {
    section: rendered.document.querySelector('[aria-label="Recommended plan"]') !== null,
    heading: rendered.queryByText('Recommended agent') !== null,
    agent: rendered.queryByText('Final Video Compositor') !== null,
    digest: rendered.queryByText(`plan ${DIGEST.slice(0, 12)}`) !== null,
    start: rendered.queryByText('Start production') !== null,
  };
}

test('a positive credit ceiling and zero consequential-spend default are explicit', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    const calls = stubFetch(rendered, [{ status: 200, body: planResponse }]);
    assert.equal(planButton(rendered).disabled, true);
    await fillGoal(rendered);
    assert.equal(planButton(rendered).disabled, false);
    await rendered.click(planButton(rendered));
    assert.equal(calls[0].body.action, 'prepare');
    assert.equal(calls[0].body.max_budget_credits, 100);
    assert.match(String(calls[0].body.idempotency_key), /^[0-9a-f-]{36}$/i);
    assert.deepEqual(calls[0].body.consequential_action_ceiling, { max_provider_calls: 0, max_spend_minor: 0, currency: 'USD' });
    assert.ok(rendered.queryByText('Recommended agent'));
    assert.match(rendered.text(), /Final Video Compositor/);
    assert.match(rendered.text(), /Needs: Project Bundle/);
    assert.match(rendered.text(), /Produces: Video Master/);
    assert.match(rendered.text(), /Planning budget: 100 credits/);
  } finally { rendered.cleanup(); }
});

test('planning shows the full agent chain before root inputs are supplied', async () => {
  const plannerId = '33333333-3333-4333-8333-333333333333';
  const plannerVersionId = '44444444-4444-4444-8444-444444444444';
  const chain = {
    ...plan,
    nodes: [
      { ordinal: 0, role: 'generate_asset', workflow_id: plannerId, workflow_version_id: plannerVersionId, slug: 'visual-treatment-planner-runway-remotion', agent: { name: 'Visual Treatment Planner — Runway + Remotion', task_key: 'video.visual_treatment_plan', task_label: 'Visual Treatment Planner', required_input_types: ['presenter_video'], output_types: ['project_bundle'] }, budget_credits: 30, max_duration_ms: 3600000, max_retries: 1, max_invocations: 1000 },
      { ...plan.nodes[0], ordinal: 1, budget_credits: 70, agent: { name: 'Visual Evidence & Remotion Compositor', task_key: 'video.final_master', task_label: 'Visual Evidence & Remotion Compositor', required_input_types: ['project_bundle'], output_types: ['video_master'] } },
    ],
    budget: { ...plan.budget, allocations: [{ ordinal: 0, budget_credits: 30 }, { ordinal: 1, budget_credits: 70 }] },
    unresolved_missing_assets: [{ kind: 'presenter_video', description: 'Visual Treatment Planner needs presenter_video before this plan can start' }],
  };
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [{ status: 200, body: { ...planResponse, plan: chain } }]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    assert.match(rendered.text(), /Recommended agent chain/);
    assert.match(rendered.text(), /2 agents will work in this order/);
    assert.match(rendered.text(), /Visual Treatment Planner — Runway \+ Remotion/);
    assert.match(rendered.text(), /Visual Evidence & Remotion Compositor/);
    assert.match(rendered.text(), /Presenter Video \(you provide\)/);
    assert.match(rendered.text(), /Project Bundle \(from step 1\)/);
    assert.match(rendered.text(), /What you’ll provide before starting/);
    assert.match(rendered.text(), /recommendation is complete; these inputs only gate execution/i);
    assert.ok(rendered.queryByText('Add Presenter Video'));
    assert.equal(rendered.queryByText('Start production'), null);
    assert.equal(rendered.queryByText('One input is still needed'), null);
  } finally { rendered.cleanup(); }
});

test('the plan collects its missing root input, replans, and exposes Start production', async () => {
  const runInstructions = 'Keep the final video 16:9.\nUse cinematic pacing.';
  const canonicalInstructions = 'Keep the final video 16:9. Use cinematic pacing.';
  const missingPlan = {
    ...plan,
    nodes: [{
      ...plan.nodes[0],
      agent: { ...plan.nodes[0].agent, required_input_types: ['presenter_video'] },
    }],
    unresolved_missing_assets: [{ kind: 'presenter_video', description: 'Final Video Compositor needs presenter_video before this plan can start' }],
  };
  const verifiedReference = {
    kind: 'artifact', id: ARTIFACT_ID, digest: DIGEST, description: 'presenter.mov',
    input_type: 'presenter_video', input_session_id: INPUT_SESSION_ID,
  };
  const pickerCalls: Record<string, unknown>[] = [];
  const rendered = await render('outcome-entry.tsx', {}, { bridge: { pickRunInput: async (options: Record<string, unknown>) => {
    pickerCalls.push(options);
    return {
      ok: true, inputSessionId: INPUT_SESSION_ID, artifactId: ARTIFACT_ID, sha256: DIGEST,
      displayName: 'presenter.mov', mediaType: 'video/quicktime',
    };
  } } });
  try {
    const calls = stubFetch(rendered, [
      { status: 200, body: { ...planResponse, plan: missingPlan } },
      { status: 200, body: { ...planResponse, intent: { ...intent, run_instructions: canonicalInstructions, input_references: [verifiedReference] } } },
    ]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    assert.equal(rendered.queryByText('Start production'), null);
    const instructions = rendered.document.getElementById('outcome-run-instructions')!;
    await type(rendered, instructions, runInstructions);
    assert.match(rendered.text(), /instructions will be bound when you add the required input/i);
    await rendered.click(rendered.getByText('Add Presenter Video'));
    assert.equal(pickerCalls[0].inputKey, 'presenter_video',
      'the Desktop registry key must equal the child request binding key');
    assert.deepEqual((calls[1].body.input_references as Record<string, unknown>[])[0], verifiedReference);
    assert.equal(calls[1].body.goal, intent.goal);
    assert.equal(calls[1].body.run_instructions, canonicalInstructions);
    assert.notEqual(calls[1].body.idempotency_key, calls[0].body.idempotency_key,
      'a verified input changes the intent and therefore requires a fresh idempotency key');
    assert.ok(rendered.queryByText('Start production'));
    assert.match(rendered.text(), /Included in this plan/);
  } finally { rendered.cleanup(); }
});

test('a startable plan must bind edited run instructions before production can start', async () => {
  const runInstructions = 'Use a restrained visual style and preserve all factual citations.';
  const rendered = await render('outcome-entry.tsx', {});
  try {
    const calls = stubFetch(rendered, [
      { status: 200, body: planResponse },
      { status: 200, body: { ...planResponse, intent: { ...intent, run_instructions: runInstructions } } },
    ]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    assert.ok(rendered.queryByText('Start production'));
    await type(rendered, rendered.document.getElementById('outcome-run-instructions')!, runInstructions);
    assert.equal(rendered.queryByText('Start production'), null, 'an edited instruction cannot ride an old plan digest');
    assert.ok(rendered.queryByText('Apply instructions to plan'));
    await rendered.click(rendered.getByText('Apply instructions to plan'));
    assert.equal(calls[1].body.goal, intent.goal);
    assert.equal(calls[1].body.run_instructions, runInstructions);
    assert.notEqual(calls[1].body.idempotency_key, calls[0].body.idempotency_key);
    assert.ok(rendered.queryByText('Start production'));
    assert.match(rendered.text(), /Included in this plan/);
  } finally { rendered.cleanup(); }
});

test('browser mode requires Implexa Desktop and has no file input fallback', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    assert.match(rendered.text(), /Open Implexa Desktop/);
    assert.equal(rendered.document.querySelector('input[type="file"]'), null);
    await rendered.click(rendered.getByText('Add verified artifact'));
    assert.match(rendered.text(), /Browser filenames are not accepted/);
  } finally { rendered.cleanup(); }
});

test('Desktop reference-in-place artifacts use the canonical wire value, warn about the drive, and never send local metadata', async () => {
  const pickerCalls: Record<string, unknown>[] = [];
  const rendered = await render('outcome-entry.tsx', {}, { bridge: { pickRunInput: async (options: Record<string, unknown>) => {
    pickerCalls.push(options);
    return { ok: true, inputSessionId: INPUT_SESSION_ID, artifactId: ARTIFACT_ID, sha256: DIGEST, displayName: 'project-bundle.zip', mediaType: 'application/zip', storageMode: 'local_range_capability' };
  } } });
  try {
    const calls = stubFetch(rendered, [{ status: 200, body: { ...planResponse, intent: { ...intent, input_references: [{ kind: 'artifact', id: ARTIFACT_ID, digest: DIGEST, description: 'project-bundle.zip', input_type: 'project_bundle', input_session_id: INPUT_SESSION_ID }] } } }]);
    await selectValue(rendered, rendered.document.querySelector('[aria-label="Type of verified artifact to add"]') as HTMLSelectElement, 'project_bundle');
    await rendered.click(rendered.getByText('Add verified artifact'));
    assert.ok(rendered.queryByText('project-bundle.zip'));
    assert.ok(rendered.queryByText(/Kept on its current drive/));
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    const reference = (calls[0].body.input_references as Record<string, unknown>[])[0];
    assert.deepEqual(reference, { kind: 'artifact', id: ARTIFACT_ID, digest: DIGEST, description: 'project-bundle.zip', input_type: 'project_bundle', input_session_id: INPUT_SESSION_ID });
    assert.equal('displayName' in reference, false);
    assert.equal('mediaType' in reference, false);
    assert.equal('inputSessionId' in reference, false);
    assert.equal('storageMode' in reference, false);
    assert.equal(pickerCalls[0].inputKey, 'project_bundle');
    assert.equal(pickerCalls[0].selection, 'file');
  } finally { rendered.cleanup(); }
});

test('Desktop managed copies use the canonical wire value and render their local storage posture', async () => {
  const rendered = await render('outcome-entry.tsx', {}, { bridge: { pickRunInput: async () => ({
    ok: true, inputSessionId: INPUT_SESSION_ID, artifactId: ARTIFACT_ID, sha256: DIGEST,
    displayName: 'small-video.mp4', mediaType: 'video/mp4', storageMode: 'managed_copy',
  }) } });
  try {
    await rendered.click(rendered.getByText('Add verified artifact'));
    assert.ok(rendered.queryByText('Copied into Implexa-managed storage for this run.'));
    assert.equal(rendered.queryByText(/Kept on its current drive/), null);
  } finally { rendered.cleanup(); }
});

test('an unknown Desktop storage mode is not assigned either storage authority', async () => {
  const rendered = await render('outcome-entry.tsx', {}, { bridge: { pickRunInput: async () => ({
    ok: true, inputSessionId: INPUT_SESSION_ID, artifactId: ARTIFACT_ID, sha256: DIGEST,
    displayName: 'future-video.mp4', mediaType: 'video/mp4', storageMode: 'future_transport',
  }) } });
  try {
    await rendered.click(rendered.getByText('Add verified artifact'));
    assert.ok(rendered.queryByText('future-video.mp4'));
    assert.equal(rendered.queryByText(/Kept on its current drive/), null);
    assert.equal(rendered.queryByText(/Copied into Implexa-managed storage/), null);
  } finally { rendered.cleanup(); }
});

test('large local input verification reports byte progress, makes the no-upload boundary explicit, and cancels only its operation', async () => {
  let progressListener: ((progress: Record<string, unknown>) => void) | null = null;
  let unsubscribeCount = 0;
  let finishPick: (value: Record<string, unknown>) => void = () => {};
  const canceled: string[] = [];
  const rendered = await render('outcome-entry.tsx', {}, { bridge: {
    onRunInputProgress: (listener: (progress: Record<string, unknown>) => void) => {
      progressListener = listener;
      return () => { unsubscribeCount += 1; };
    },
    pickRunInput: async () => new Promise<Record<string, unknown>>((resolve) => { finishPick = resolve; }),
    cancelRunInputVerification: async (operationId: string) => {
      canceled.push(operationId);
      finishPick({ ok: false, canceled: true });
      return { ok: true, canceled: true };
    },
  } });
  try {
    const add = rendered.getByText('Add verified artifact');
    await rendered.click(add);

    await rendered.act(() => progressListener?.({
      operationId: 'old-operation', inputKey: 'project_bundle', phase: 'verifying_local',
      bytesRead: 7 * 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: 100, etaSeconds: 10, cancelable: true,
    }));
    assert.equal(rendered.queryByText(/not uploading/i), null,
      'a global progress event for another input must not attach to this picker');

    await rendered.act(() => progressListener?.({
      operationId: 'registering-video', inputKey: 'presenter_video', phase: 'registering',
      bytesRead: 8 * 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: null, etaSeconds: null, cancelable: false,
    }));
    assert.equal(rendered.queryByText(/not uploading/i), null,
      'the registering phase is not presented as cancelable local verification');

    await rendered.act(() => progressListener?.({
      operationId: 'future-video', inputKey: 'presenter_video', phase: 'future_phase',
      bytesRead: 2 * 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: 100, etaSeconds: 10, cancelable: true,
    }));
    assert.equal(rendered.queryByText(/not uploading/i), null,
      'an unknown Desktop phase fails closed instead of becoming a cancel authority');

    await rendered.act(() => progressListener?.({
      operationId: 'noncancelable-video', inputKey: 'presenter_video', phase: 'verifying_local',
      bytesRead: 2 * 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: 100, etaSeconds: 10, cancelable: false,
    }));
    assert.equal(rendered.queryByText(/not uploading/i), null,
      'a noncancelable event cannot mint a cancel affordance merely by naming the verification phase');

    await rendered.act(() => progressListener?.({
      operationId: 'verify-8gb-video', inputKey: 'presenter_video', phase: 'verifying_local',
      bytesRead: 2 * 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: 100, etaSeconds: 10, cancelable: true,
    }));
    assert.ok(rendered.queryByText('Reading locally to verify — not uploading'));
    assert.ok(rendered.queryByText(/presenter video · 2\.0 GB of 8\.0 GB · 25%/));
    const bar = rendered.document.querySelector('[role="progressbar"]')!;
    assert.equal(bar.getAttribute('aria-valuenow'), '25');

    await rendered.act(() => progressListener?.({
      operationId: 'stale-same-key-operation', inputKey: 'presenter_video', phase: 'verifying_local',
      bytesRead: 6 * 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: 100, etaSeconds: 10, cancelable: true,
    }));
    assert.equal(bar.getAttribute('aria-valuenow'), '25',
      'once correlated, a late same-key event from another operation cannot replace it');

    await rendered.click(rendered.getByText('Cancel'));
    assert.deepEqual(canceled, ['verify-8gb-video']);
    assert.equal(rendered.queryByText(/not uploading/i), null);
  } finally {
    rendered.cleanup();
    assert.equal(unsubscribeCount, 1, 'unmount removes the global Desktop progress listener');
  }
});

test('missing-plan input verification renders progress beside the input that initiated it', async () => {
  const missingPlan = {
    ...plan,
    nodes: [{ ...plan.nodes[0], agent: { ...plan.nodes[0].agent, required_input_types: ['presenter_video'] } }],
    unresolved_missing_assets: [{ kind: 'presenter_video', description: 'Final Video Compositor needs presenter_video before this plan can start' }],
  };
  let progressListener: ((progress: Record<string, unknown>) => void) | null = null;
  const rendered = await render('outcome-entry.tsx', {}, { bridge: {
    onRunInputProgress: (listener: (progress: Record<string, unknown>) => void) => { progressListener = listener; return () => {}; },
    pickRunInput: async () => new Promise(() => {}),
    cancelRunInputVerification: async () => ({ ok: true }),
  } });
  try {
    stubFetch(rendered, [{ status: 200, body: { ...planResponse, plan: missingPlan } }]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    await rendered.click(rendered.getByText('Add Presenter Video'));
    await rendered.act(() => progressListener?.({
      operationId: 'plan-video', inputKey: 'presenter_video', phase: 'verifying_local',
      bytesRead: 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: 100, etaSeconds: 10, cancelable: true,
    }));
    const missing = rendered.document.querySelector('[aria-label="Missing inputs"]')!;
    assert.match(missing.textContent || '', /Reading locally to verify — not uploading/);
    assert.match(missing.textContent || '', /presenter video · 1\.0 GB of 8\.0 GB · 13%/);
    assert.equal(rendered.document.querySelectorAll('[aria-label="Local input verification"]').length, 1,
      'the same operation is not duplicated above and inside the plan');
    await rendered.act(() => progressListener?.({
      operationId: 'other-plan-video', inputKey: 'presenter_video', phase: 'registering',
      bytesRead: 8 * 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: null, etaSeconds: null, cancelable: false,
    }));
    assert.equal(rendered.document.querySelectorAll('[aria-label="Local input verification"]').length, 1,
      'another same-key operation cannot hide the active operation');
    await rendered.act(() => progressListener?.({
      operationId: 'plan-video', inputKey: 'presenter_video', phase: 'registering',
      bytesRead: 8 * 1024 ** 3, totalBytes: 8 * 1024 ** 3,
      bytesPerSecond: null, etaSeconds: null, cancelable: false,
    }));
    assert.equal(rendered.queryByText(/not uploading/i), null,
      'the exact operation loses its cancel affordance before registration commits');
  } finally { rendered.cleanup(); }
});

test('one Backend clarification renders only its choices and resubmits the same request with task key', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    const calls = stubFetch(rendered, [
      { status: 200, body: { ok: true, kind: 'clarification_required', clarification: { question: 'Which final outcome?', choices: [{ taskKey: 'video', label: 'Final video', outputTypes: ['video'] }, { taskKey: 'project', label: 'Editable project', outputTypes: ['project'] }] } } },
      { status: 200, body: planResponse },
    ]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    assert.ok(rendered.queryByText('Which final outcome?'));
    assert.equal(rendered.queryByText('Use recommended'), null);
    await rendered.click(rendered.getByText('Final video'));
    assert.equal(calls[1].body.goal, calls[0].body.goal);
    assert.equal(calls[1].body.quality, calls[0].body.quality);
    assert.equal(calls[1].body.clarification_task_key, 'video');
    assert.ok(rendered.queryByText('Recommended agent'));
  } finally { rendered.cleanup(); }
});

test('Start uses Backend production identity and expected plan digest only', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    const calls = stubFetch(rendered, [{ status: 200, body: planResponse }, { status: 200, body: { ok: true, productionId: PRODUCTION_ID } }]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    await rendered.click(rendered.getByText('Start production'));
    assert.deepEqual(calls[1].body, { action: 'start', productionId: PRODUCTION_ID, expected_plan_digest: DIGEST });
    assert.equal(rendered.calls.push[0], `/runs/productions/${PRODUCTION_ID}`);
  } finally { rendered.cleanup(); }
});

test('a typed Backend start refusal remains visible without discarding the current plan', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [
      { status: 200, body: planResponse },
      { status: 422, body: { ok: false, reason: 'grant_signing_unavailable', error: 'Child grant signing key is not configured.' } },
    ]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    await rendered.click(rendered.getByText('Start production'));
    assert.match(rendered.text(), /child grant signing key is not configured/i);
    assert.ok(rendered.queryByText('Recommended agent'));
    assert.ok(rendered.queryByText('Start production'));
    assert.equal(rendered.queryByText('That plan is no longer current. Plan again to get a fresh one.'), null);
  } finally { rendered.cleanup(); }
});

test('a plan-digest mismatch still invalidates the current plan', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [
      { status: 200, body: planResponse },
      { status: 422, body: { ok: false, reason: 'plan_digest_mismatch', error: 'The approved plan digest is no longer current.' } },
    ]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    await rendered.click(rendered.getByText('Start production'));
    assert.ok(rendered.queryByText('That plan is no longer current. Plan again to get a fresh one.'));
    assert.equal(rendered.queryByText('Start production'), null);
  } finally { rendered.cleanup(); }
});

// A plan is an answer to one exact goal. Editing the goal while a prepare is
// still in flight makes that answer stale, and a stale plan must not become the
// thing the user starts: the production would run the PREVIOUS goal under a
// digest that looks current. Two independent guards enforce this — the edit
// bumps `reqId`, and the resolved prepare re-checks it before applying — so this
// asserts the observable outcome (nothing shown, nothing startable) rather than
// either mechanism, and stays honest if only one of them is left standing.
test('a goal edited mid-flight discards the stale plan — it is neither shown nor startable', async () => {
  const FIRST_GOAL = 'Produce a final master from my approved sections.';
  const EDITED_GOAL = 'Produce a subtitled social cutdown for launch week instead.';
  const rendered = await render('outcome-entry.tsx', {});
  try {
    const calls: FetchCall[] = [];
    let release: () => void = () => {};
    (rendered.window as unknown as Record<string, unknown>).fetch = async (url: string, init: { body: string }) => {
      const requestBody = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ url, body: requestBody });
      // Only the first prepare is held open; the replan at the end resolves at once.
      if (calls.length === 1) await new Promise<void>((resolve) => { release = resolve; });
      return { ok: true, status: 200, json: async () => ({
        ...planResponse, intent: { ...intent, goal: requestBody.goal },
      }) };
    };
    const goalField = rendered.document.getElementById('outcome-goal') as HTMLTextAreaElement;

    await type(rendered, goalField, FIRST_GOAL);
    await rendered.click(planButton(rendered));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.goal, FIRST_GOAL);

    // The goal changes while the answer to the previous goal is still in flight.
    await type(rendered, goalField, EDITED_GOAL);
    await rendered.act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 5)); });

    // Asserted as booleans, never as the elements themselves: node:test serialises
    // an AssertionError's `actual`, and a jsdom node drags the whole document into
    // that dump — the failure then costs ~50s and dies before it is ever reported.
    assert.deepEqual(planSurface(rendered), {
      section: false, heading: false, agent: false, digest: false, start: false,
    }, 'a plan prepared for the replaced goal must be neither shown nor startable');
    assert.equal(calls.length, 1, 'the discarded plan must not reach the start endpoint');
    assert.deepEqual(rendered.calls.push, [], 'nothing was started, so nothing was navigated to');

    // The edit survives, and planning the goal the user actually typed still works.
    assert.equal(goalField.value, EDITED_GOAL);
    assert.equal(planButton(rendered).disabled, false);
    await rendered.click(planButton(rendered));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.goal, EDITED_GOAL);
    assert.deepEqual(planSurface(rendered), {
      section: true, heading: true, agent: true, digest: true, start: true,
    }, 'the plan for the goal actually typed is shown and startable');
  } finally { rendered.cleanup(); }
});

test('an unreadable prepare response fails closed', async () => {
  const drifted = await render('outcome-entry.tsx', {});
  try {
    stubFetch(drifted, [{ status: 200, body: { ok: true, kind: 'plan', productionId: PRODUCTION_ID, intent, plan: { drifted: true } } }]);
    await fillGoal(drifted);
    await drifted.click(planButton(drifted));
    assert.ok(drifted.document.querySelector('[aria-label="Planning unavailable"]'));
    assert.equal(drifted.queryByText('Start production'), null);
  } finally { drifted.cleanup(); }
});

test('a typed Backend prepare refusal is visible instead of masquerading as an outage', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [{
      status: 422,
      body: { ok: false, reason: 'artifact_not_verified', error: 'The selected artifact is no longer verified.' },
    }]);
    await fillGoal(rendered);
    await rendered.click(planButton(rendered));
    assert.match(rendered.text(), /selected artifact is no longer verified/i);
    assert.equal(rendered.document.querySelector('[aria-label="Planning unavailable"]'), null);
  } finally { rendered.cleanup(); }
});
