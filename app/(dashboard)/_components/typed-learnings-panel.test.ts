import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

// Slice 3 (backend 0471): the trainer admits typed learnings; this panel must send exact,
// digest-bound decisions and never offer admission while the backend would refuse it.
const CAND = '33333333-3333-4333-8333-333333333333';
const EV = '44444444-4444-4444-8444-444444444444';
const RV = '55555555-5555-4555-8555-555555555555';
const evidence = [{ id: EV, kind: 'annotated_visual_frame_v1', side: 'before', status: 'validated', stored: true,
  mediaStartMs: null, mediaEndMs: null, captureTimeMs: 10000, frameTimesMs: null }];
const preview = (over = {}) => ({ id: 'p1', evaluated: false, evaluator: null, blocksKnownGood: false,
  relatedRunIds: ['r1', 'r2'], acceptedRunIds: ['r1'], wouldCatchRunIds: [], wouldBlockRunIds: [], relatedEvidenceIds: [], computedAt: '2026-10-16', ...over });
const candidate = (over = {}) => ({ candidateId: CAND, candidateKey: 'a'.repeat(64), text: 'labels never reveal before their narration ends',
  polarity: 'negative', dismissed: false, revision: 2, typedDigest: 'd'.repeat(64), learningType: 'criterion', owningStage: 'qa',
  category: 'motion_timing', scope: 'agent', checkState: null, classification: { source: 'trainer' }, evidence, preview: preview(), ...over });
const payload = (c = candidate(), rules: unknown[] = []) => ({ ok: true, candidates: [c], rules });

async function mount(p: unknown, backend?: (path: string, init: unknown) => unknown) {
  return render('typed-learnings-panel.tsx', { slug: 'video/agent', initialPayload: p, initialSource: 'ready' },
    { backend: backend || (() => p) });
}
const posts = (r: Awaited<ReturnType<typeof render>>) =>
  r.calls.backend.filter((c) => (c.init as { method?: string })?.method === 'POST');
const button = (r: Awaited<ReturnType<typeof render>>, text: string) =>
  [...r.document.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement | undefined;

test('an untyped draft says the trainer decides, and cannot be admitted', async () => {
  const r = await mount(payload(candidate({ learningType: null, classification: { source: 'heuristic' } })));
  try {
    assert.ok(r.getByText(/Untyped — you decide/));
    assert.ok(r.getByText(/drafted from your words; not typed/));
    await r.click(r.getByText('Review & admit'));
    assert.ok(r.getByText(/Choose a type: nothing is admitted untyped/));
    assert.equal(button(r, 'Admit learning')!.disabled, true);
  } finally { r.cleanup(); }
});

test('the evidence is shown with its side and time, not a paraphrase', async () => {
  const r = await mount(payload());
  try { assert.ok(r.getByText(/Evidence: before · marked frame at 10\.0s/)); } finally { r.cleanup(); }
});

test('admission sends the exact candidate key and typed digest', async () => {
  const p = payload();
  const r = await mount(p, (path) => (String(path).endsWith('/admit') ? { ok: true, ruleVersionId: RV, activation: 'next_agent_version' } : p));
  try {
    await r.click(r.getByText('Review & admit'));
    assert.equal(button(r, 'Admit learning')!.disabled, false);
    await r.click(r.getByText('Admit learning'));
    const writes = posts(r);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `/api/v2/agents/video%2Fagent/learning-influence/typed/${CAND}/admit`);
    assert.equal(JSON.stringify((writes[0].init as { body?: unknown }).body), JSON.stringify({
      candidateKey: 'a'.repeat(64), typedDigest: 'd'.repeat(64), acknowledgeKnownGoodBlocks: false, confirmCategoryWide: false }));
  } finally { r.cleanup(); }
});

test('a preview that blocks an accepted output must be acknowledged before admitting', async () => {
  const p = payload(candidate({ preview: preview({ evaluated: true, evaluator: 'fixture', blocksKnownGood: true, wouldBlockRunIds: ['r1'] }) }));
  const r = await mount(p, (path) => (String(path).endsWith('/admit') ? { ok: true, ruleVersionId: RV } : p));
  try {
    await r.click(r.getByText('Review & admit'));
    assert.equal(button(r, 'Admit learning')!.disabled, true);
    const box = [...r.document.querySelectorAll('input[type=checkbox]')][0] as HTMLInputElement;
    await r.click(box);
    assert.equal(button(r, 'Admit learning')!.disabled, false);
    await r.click(r.getByText('Admit learning'));
    assert.equal((posts(r)[0].init as { body: { acknowledgeKnownGoodBlocks: boolean } }).body.acknowledgeKnownGoodBlocks, true);
  } finally { r.cleanup(); }
});

test('category-wide scope needs its own confirmation', async () => {
  const r = await mount(payload(candidate({ scope: 'category_wide' })));
  try {
    await r.click(r.getByText('Review & admit'));
    assert.ok(r.getByText(/Confirm the category-wide scope/));
    assert.equal(button(r, 'Admit learning')!.disabled, true);
  } finally { r.cleanup(); }
});

test('without a preview of THIS version, the trainer runs one first', async () => {
  const p = payload(candidate({ preview: null }));
  const r = await mount(p, (path) => (String(path).endsWith('/preview') ? { ok: true } : p));
  try {
    await r.click(r.getByText('Review & admit'));
    assert.equal(button(r, 'Admit learning')!.disabled, true);
    await r.click(r.getByText('Run preview'));
    const w = posts(r);
    assert.equal(w[0].path, `/api/v2/agents/video%2Fagent/learning-influence/typed/${CAND}/preview`);
    assert.equal(JSON.stringify((w[0].init as { body?: unknown }).body), JSON.stringify({ typedDigest: 'd'.repeat(64) }));
  } finally { r.cleanup(); }
});

test('admitted learnings say where they go; nothing is shown when the source is unverifiable', async () => {
  const rule = { ruleId: 'r', ruleVersionId: RV, version: 1, state: 'active', text: 'calmer transitions in data scenes', learningType: 'taste',
    owningStage: 'build', category: 'pacing', scope: 'agent', evidenceIds: [EV], activation: { target: 'per_run_snapshot' } };
  const r = await mount({ ok: true, candidates: [], rules: [rule] });
  try { assert.ok(r.getByText(/Goes into each run’s taste snapshot/)); } finally { r.cleanup(); }
  const u = await render('typed-learnings-panel.tsx', { slug: 'video-agent', initialPayload: null, initialSource: 'unavailable' }, { backend: () => ({}) });
  try {
    assert.ok(u.getByText('Typed learnings unavailable'));
    assert.equal(u.queryByText('Draft from a Review issue'), null);
  } finally { u.cleanup(); }
});

test('a retype and restage is one digest-bound edit, followed by a fresh preview of the new version', async () => {
  const p = payload(candidate({ learningType: null, owningStage: null, classification: { source: 'heuristic' } }));
  const r = await mount(p, (path) => (String(path).endsWith('/edit') ? { ok: true, candidateId: CAND, typedDigest: 'e'.repeat(64) }
    : String(path).endsWith('/preview') ? { ok: true } : p));
  try {
    await r.click(r.getByText('Review & admit'));
    await r.act(() => {
      for (const [name, value] of [['Type', 'taste'], ['Stage', 'build']] as const) {
        const select = r.document.querySelector(`select[aria-label="${name}"]`) as HTMLSelectElement;
        Object.getOwnPropertyDescriptor(r.window.HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
        select.dispatchEvent(new r.window.Event('change', { bubbles: true }));
      }
    });
    await r.click(r.getByText('Save changes'));
    const w = posts(r);
    assert.equal(w[0].path, `/api/v2/agents/video%2Fagent/learning-influence/typed/${CAND}/edit`);
    assert.equal(JSON.stringify((w[0].init as { body?: unknown }).body), JSON.stringify({
      typedDigest: 'd'.repeat(64), edits: { learningType: 'taste', owningStage: 'build' } }));
    assert.equal(JSON.stringify((w[1].init as { body?: unknown }).body), JSON.stringify({ typedDigest: 'e'.repeat(64) }), 'the preview is of the new version');
  } finally { r.cleanup(); }
});
