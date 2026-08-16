// node --test "app/(dashboard)/_components/outcome-entry.render.test.ts"
//
// The outcome-first entry, rendered and clicked. These pin the surface's
// load-bearing promises:
//   1. Plan is a free, explicit step — nothing is requested until the user
//      asks, and Start exists only inside a server-prepared plan.
//   2. The plan the user approves is the plan that starts: id + digest travel
//      VERBATIM, and editing any input discards the shown plan.
//   3. Fail-closed: an unreadable planner answer renders "we can't plan",
//      which is a different claim from the contracted "no eligible agent".
//   4. The approvals are real gates: Start stays disabled until every
//      required approval is explicitly acknowledged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render, type Rendered } from '../../../lib/test/render.ts';
import fixture from '../../../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };

type FetchCall = { url: string; body: Record<string, unknown> };

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
  await rendered.act(() => {
    setter.call(element, value);
    element.dispatchEvent(new (rendered.window as unknown as { Event: typeof Event }).Event('input', { bubbles: true }));
  });
}

async function fillRequest(rendered: Rendered) {
  await type(rendered, rendered.document.getElementById('outcome-goal')!, 'Use my approved video sections to produce a final master.');
  await type(rendered, rendered.document.getElementById('outcome-budget')!, '40');
}

const planButton = (rendered: Rendered) => rendered.getByText('Plan this outcome') as HTMLButtonElement;

test('the form is accessible and Plan stays disabled until goal and budget exist', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    // Labeled controls, native radio group, and no plan/start affordance yet.
    assert.ok(rendered.document.querySelector('label[for="outcome-goal"]'));
    assert.ok(rendered.document.querySelector('label[for="outcome-budget"]'));
    const radios = rendered.document.querySelectorAll('input[type="radio"][name="outcome-quality"]');
    assert.equal(radios.length, 3, 'Fast/Balanced/Best are native radios');
    assert.ok(rendered.queryByText('Fast') && rendered.queryByText('Balanced') && rendered.queryByText('Best'));
    assert.equal((radios[1] as HTMLInputElement).checked, true, 'Balanced is the default');
    assert.equal(planButton(rendered).disabled, true);
    assert.equal(rendered.queryByText('Start production'), null, 'no start affordance before a server plan exists');

    await fillRequest(rendered);
    assert.equal(planButton(rendered).disabled, false);
  } finally { rendered.cleanup(); }
});

test('Plan renders the server-prepared plan; Start is gated on the approval and echoes the digest verbatim', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    const calls = stubFetch(rendered, [
      { status: 200, body: fixture.responses.planPrepared },
      { status: 200, body: fixture.responses.startAccepted },
    ]);
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));

    // The plan request carries the typed request, not a ranking.
    assert.equal(calls[0].url, '/api/outcome-productions');
    assert.equal(calls[0].body.action, 'plan');
    assert.equal(calls[0].body.quality, 'balanced');
    assert.equal(calls[0].body.maxBudgetCents, 4000);

    // The server's selection renders with its reasons and estimate — and no raw score.
    assert.ok(rendered.queryByText('Proposed plan'));
    assert.ok(rendered.queryByText(/Cinematic compositor/));
    assert.ok(rendered.queryByText(/Task signature matches the requested deliverable/));
    assert.ok(rendered.queryByText(/Why this agent/));
    // The scorer VERSION renders (it is the inspectable identity); a raw
    // score value never does.
    assert.doesNotMatch(rendered.text(), /score[:=]?\s*\d/i, 'no raw score value renders');

    const start = rendered.getByText('Start production') as HTMLButtonElement;
    assert.equal(start.disabled, true, 'Start waits for the spend approval');
    const approval = rendered.document.querySelector('input[type="checkbox"]')!;
    await rendered.click(approval);
    assert.equal((rendered.getByText('Start production') as HTMLButtonElement).disabled, false);

    await rendered.click(rendered.getByText('Start production'));
    assert.equal(calls[1].body.action, 'start');
    assert.equal(calls[1].body.planId, fixture.plans.single.id);
    assert.equal(calls[1].body.planDigest, fixture.plans.single.digest, 'the digest travels verbatim');
    assert.equal(rendered.calls.push[0], `/runs/productions/${fixture.responses.startAccepted.productionId}`);
  } finally { rendered.cleanup(); }
});

test('editing any input discards the shown plan — a stale plan never looks startable', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [{ status: 200, body: fixture.responses.planPrepared }]);
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));
    assert.ok(rendered.queryByText('Proposed plan'));

    await type(rendered, rendered.document.getElementById('outcome-goal')!, 'A different outcome entirely, please.');
    assert.equal(rendered.queryByText('Proposed plan'), null);
    assert.equal(rendered.queryByText('Start production'), null);
  } finally { rendered.cleanup(); }
});

test('an unreadable planner answer fails closed — and is not the no-eligible claim', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [{ status: 200, body: { ok: true, result: 'plan', plan: { drifted: true } } }]);
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));

    const status = rendered.document.querySelector('[role="status"][aria-label="Planning unavailable"]');
    assert.ok(status, 'the unavailable state is an explicit status region');
    assert.match(rendered.text(), /not the same as having no eligible agent/);
    assert.equal(rendered.queryByText('Start production'), null);
    assert.equal(rendered.queryByText('No eligible agent for this outcome'), null);
  } finally { rendered.cleanup(); }
});

test('the contracted no-eligible answer renders its exclusions and offers no start or fallback', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [{ status: 200, body: fixture.responses.planNoEligible }]);
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));

    assert.ok(rendered.queryByText('No eligible agent for this outcome'));
    assert.ok(rendered.queryByText(/Archive transcoder/), 'exclusions render with their reasons');
    assert.ok(rendered.queryByText(/Nothing was started and nothing will run/));
    assert.equal(rendered.queryByText('Start production'), null);
  } finally { rendered.cleanup(); }
});

test('a plan blocked on setup shows the owner actions and withholds Start', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [{ status: 200, body: fixture.responses.planBlockedOnSetup }]);
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));

    assert.ok(rendered.queryByText('Finish setup before this plan can start'));
    assert.ok(rendered.queryByText(/Verify the render engine connection/));
    assert.equal(rendered.queryByText('Start production'), null);
  } finally { rendered.cleanup(); }
});

test('a refused start (409) discards the stale plan instead of retrying it', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [
      { status: 200, body: fixture.responses.planPrepared },
      { status: 409, body: { ok: false, error: 'stale_plan' } },
    ]);
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));
    await rendered.click(rendered.document.querySelector('input[type="checkbox"]')!);
    await rendered.click(rendered.getByText('Start production'));

    assert.equal(rendered.queryByText('Proposed plan'), null, 'the refused plan is discarded');
    assert.match(rendered.text(), /no longer current/);
    assert.equal(rendered.calls.push.length, 0, 'nothing navigates as if production began');
  } finally { rendered.cleanup(); }
});

test('REGRESSION: a plan answered for a superseded request is dropped, not rendered', async () => {
  // The clear-on-edit is not enough on its own: the clear happens now and the
  // response lands later. Without a request-generation guard the old plan
  // repainted itself — startable, with a genuine digest the backend would
  // honour, against a ceiling the user had already changed.
  const rendered = await render('outcome-entry.tsx', {});
  try {
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => { release = r; });
    (rendered.window as unknown as Record<string, unknown>).fetch = async () => {
      await gate;
      return { ok: true, status: 200, json: async () => fixture.responses.planPrepared };
    };
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));

    // The user changes the budget while the plan request is still in flight.
    await type(rendered, rendered.document.getElementById('outcome-budget')!, '400');
    assert.equal(rendered.queryByText('Proposed plan'), null);

    await rendered.act(async () => { release(null); await new Promise((r) => setTimeout(r, 5)); });

    assert.equal(rendered.queryByText('Proposed plan'), null, 'the superseded plan never repaints');
    assert.equal(rendered.queryByText('Start production'), null, 'and nothing stale is startable');
    assert.doesNotMatch(rendered.text(), /\$40\.00/, 'the old ceiling is gone with it');
  } finally { rendered.cleanup(); }
});

test('an unconfirmed start points at the safe retry, not at planning again', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    const calls = stubFetch(rendered, [
      { status: 200, body: fixture.responses.planPrepared },
      { status: 503, body: { ok: false, error: 'unreachable' } },
    ]);
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));
    await rendered.click(rendered.document.querySelector('input[type="checkbox"]')!);
    await rendered.click(rendered.getByText('Start production'));

    // Planning again would mint a new plan AND a new idempotency key, so a
    // start that had in fact landed would reserve the budget a second time.
    assert.match(rendered.text(), /cannot reserve your budget twice/);
    assert.doesNotMatch(rendered.text(), /plan again rather than assuming/);
    const retry = rendered.queryByText('Start production') as HTMLButtonElement | null;
    assert.ok(retry && !retry.disabled, 'the safe action stays available');

    // And the retry reuses the SAME key, which is what makes it safe.
    await rendered.click(retry!);
    assert.equal(calls[2].body.idempotencyKey, calls[1].body.idempotencyKey);
  } finally { rendered.cleanup(); }
});

test('REGRESSION: editing during a start does not wedge the next plan’s Start button', async () => {
  // `starting` is this action's own in-flight flag. Guarding its release
  // behind the request generation left it stuck true whenever the user edited
  // mid-start, and the NEXT plan then rendered a permanently disabled
  // "Starting…" button — no production could be started without a reload.
  const rendered = await render('outcome-entry.tsx', {});
  try {
    let release: (v: unknown) => void = () => {};
    let call = 0;
    (rendered.window as unknown as Record<string, unknown>).fetch = async () => {
      call += 1;
      if (call === 2) {
        await new Promise((r) => { release = r; });
        return { ok: false, status: 503, json: async () => ({ ok: false }) };
      }
      return { ok: true, status: 200, json: async () => fixture.responses.planPrepared };
    };
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));
    await rendered.click(rendered.document.querySelector('input[type="checkbox"]')!);
    await rendered.click(rendered.getByText('Start production'));

    // The user edits while that start is still in flight, then it fails.
    await type(rendered, rendered.document.getElementById('outcome-budget')!, '400');
    await rendered.act(async () => { release(null); await new Promise((r) => setTimeout(r, 5)); });

    // Plan again and approve: the fresh plan must be startable.
    await rendered.click(planButton(rendered));
    await rendered.act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await rendered.click(rendered.document.querySelector('input[type="checkbox"]')!);
    const start = rendered.getByText('Start production') as HTMLButtonElement;
    assert.equal(start.disabled, false, 'the new plan is startable');
    assert.equal(rendered.queryByText('Starting…'), null, 'no stale in-flight label survives');
  } finally { rendered.cleanup(); }
});

test('attachments dropped by the cap are announced, never silently narrowed', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    const input = rendered.document.getElementById('outcome-attachments')!;
    const files = Array.from({ length: 12 }, (_, i) => ({ name: `clip-${i}.mp4`, size: 100 + i }));
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await rendered.act(() => {
      input.dispatchEvent(new (rendered.window as unknown as { Event: typeof Event }).Event('change', { bubbles: true }));
    });
    assert.match(rendered.text(), /2 files were not added/);
    assert.match(rendered.text(), /at most 10 inputs/);
    assert.ok(rendered.document.querySelector('[role="status"]'));
  } finally { rendered.cleanup(); }
});

test('a two-node plan says exactly what it will run — two agents in sequence, never more', async () => {
  const rendered = await render('outcome-entry.tsx', {});
  try {
    stubFetch(rendered, [{ status: 200, body: fixture.responses.planTwoNode }]);
    await fillRequest(rendered);
    await rendered.click(planButton(rendered));

    assert.ok(rendered.queryByText(/1\. Cinematic compositor/));
    assert.ok(rendered.queryByText(/2\. Cinematic shot generator/));
    assert.match(rendered.text(), /two agents in sequence, never more/);
  } finally { rendered.cleanup(); }
});
