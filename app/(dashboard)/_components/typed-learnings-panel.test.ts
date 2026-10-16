import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

// Slice 3 (backend 0471): the trainer admits typed learnings; this panel must send exact,
// digest-bound decisions, never offer admission while the backend would refuse it, follow
// a reworded learning to its new id, and never carry an acknowledgement across versions.
const CAND = '33333333-3333-4333-8333-333333333333';
const CAND2 = '66666666-6666-4666-8666-666666666666';
const EV = '44444444-4444-4444-8444-444444444444';
const RV = '55555555-5555-4555-8555-555555555555';
const evidence = [{ id: EV, kind: 'annotated_visual_frame_v1', side: 'before', status: 'validated', stored: true,
  mediaStartMs: null, mediaEndMs: null, captureTimeMs: 10000, frameTimesMs: null }];
const preview = (over = {}) => ({ id: 'p1', evaluated: false, evaluator: null, blocksKnownGood: false,
  relatedRunIds: ['r1', 'r2'], acceptedRunIds: ['r1'], wouldCatchRunIds: [], wouldBlockRunIds: [], relatedEvidenceIds: [], computedAt: '2026-10-16', ...over });
const candidate = (over = {}) => ({ candidateId: CAND, candidateKey: 'a'.repeat(64), text: 'labels never reveal before their narration ends',
  polarity: 'negative', dismissed: false, revision: 2, typedDigest: 'd'.repeat(64), learningType: 'criterion', owningStage: 'qa',
  category: 'motion_timing', scope: 'agent', checkState: null, classification: { source: 'trainer' }, evidence, preview: preview(), ...over });
const payload = (c: unknown = candidate(), rules: unknown[] = []) => ({ ok: true, candidates: [c], rules });
const refusal = (code: string, status = 409) => Object.assign(new Error(code), { status, body: { ok: false, error: code } });

type Rendered = Awaited<ReturnType<typeof render>>;
async function mount(p: unknown, backend?: (path: string, init: unknown) => unknown) {
  return render('typed-learnings-panel.tsx', { slug: 'video/agent', initialPayload: p, initialSource: 'ready' },
    { backend: backend || (() => p) });
}
const posts = (r: Rendered) => r.calls.backend.filter((c) => (c.init as { method?: string })?.method === 'POST');
const gets = (r: Rendered) => r.calls.backend.filter((c) => !(c.init as { method?: string })?.method);
const body = (call: { init: unknown }) => JSON.stringify((call.init as { body?: unknown }).body);
const button = (r: Rendered, text: string) =>
  [...r.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const admitDisabled = (r: Rendered) => button(r, 'Admit learning')!.disabled;
async function choose(r: Rendered, values: Record<string, string>) {
  await r.act(() => {
    for (const [name, value] of Object.entries(values)) {
      const select = r.document.querySelector(`select[aria-label="${name}"]`) as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(r.window.HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
      select.dispatchEvent(new r.window.Event('change', { bubbles: true }));
    }
  });
}
async function typeText(r: Rendered, value: string) {
  await r.act(() => {
    const area = r.document.querySelector('textarea') as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value);
    area.dispatchEvent(new r.window.Event('input', { bubbles: true }));
  });
}

test('an untyped draft says the trainer decides, and cannot be admitted', async () => {
  const r = await mount(payload(candidate({ learningType: null, classification: { source: 'model', typeConfidence: 0.5 } })));
  try {
    assert.ok(r.getByText(/Untyped — you decide/));
    assert.ok(r.getByText(/a model suggested a type at 50%, below the 80% floor; you decide/));
    await r.click(r.getByText('Review & admit'));
    assert.ok(r.getByText(/Choose a type: nothing is admitted untyped/));
    assert.equal(admitDisabled(r), true);
  } finally { r.cleanup(); }
});

test('every backend refusal of admission is mirrored before the trainer can click', async () => {
  for (const [over, why] of [
    [{ owningStage: null }, /Choose the stage/],
    [{ dismissed: true }, null],
    [{ preview: null }, /Run the preview/],
    [{ evidence: [{ ...evidence[0], status: 'revoked' }] }, /no longer valid/],
  ] as const) {
    const r = await mount(payload(candidate(over)));
    try {
      if (why === null) { assert.equal(r.queryByText('Review & admit'), null, 'a dismissed suggestion is not offered'); continue; }
      await r.click(r.getByText('Review & admit'));
      assert.ok(r.getByText(why));
      assert.equal(admitDisabled(r), true, JSON.stringify(over));
    } finally { r.cleanup(); }
  }
});

test('the evidence is shown with its side and time, and a missing row is said, not invented', async () => {
  const r = await mount(payload(candidate({ evidence: [...evidence, { id: 'x', status: 'missing' }] })));
  try {
    assert.ok(r.getByText(/before · marked frame at 10\.0s; evidence no longer available/));
    assert.equal(r.queryByText(/undefined/), null);
  } finally { r.cleanup(); }
});

test('admission sends the exact candidate key and typed digest, and verifies the receipt', async () => {
  const p = payload();
  let receipt: unknown = { ok: true, ruleVersionId: RV, activation: 'next_agent_version' };
  const r = await mount(p, (path) => (String(path).endsWith('/admit') ? receipt : p));
  try {
    await r.click(r.getByText('Review & admit'));
    assert.equal(admitDisabled(r), false);
    await r.click(r.getByText('Admit learning'));
    const writes = posts(r);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `/api/v2/agents/video%2Fagent/learning-influence/typed/${CAND}/admit`);
    assert.equal(body(writes[0]), JSON.stringify({ candidateKey: 'a'.repeat(64), typedDigest: 'd'.repeat(64), previewId: 'p1',
      acknowledgeKnownGoodBlocks: false, confirmCategoryWide: false }));
    // A receipt without a rule version is not an admission.
    receipt = { ok: true };
    await r.click(r.getByText('Review & admit'));
    await r.click(r.getByText('Admit learning'));
    assert.ok(r.getByText('The learning could not be admitted.'));
  } finally { r.cleanup(); }
});

test('a known-good block must be acknowledged, and the acknowledgement never survives a new version', async () => {
  const blocking = (digest: string) => candidate({ typedDigest: digest,
    preview: preview({ evaluated: true, evaluator: 'fixture', blocksKnownGood: true, wouldBlockRunIds: ['r1'] }) });
  let current = payload(blocking('d'.repeat(64)));
  const r = await mount(current, (path) => {
    if (String(path).endsWith('/edit')) { current = payload(blocking('e'.repeat(64))); return { ok: true, candidateId: CAND, typedDigest: 'e'.repeat(64) }; }
    if (String(path).endsWith('/admit')) return { ok: true, ruleVersionId: RV };
    return current;
  });
  try {
    await r.click(r.getByText('Review & admit'));
    assert.equal(admitDisabled(r), true);
    await r.click(r.document.querySelector('input[type=checkbox]')!);
    assert.equal(admitDisabled(r), false);
    await choose(r, { Stage: 'build' });
    await r.click(r.getByText('Save changes'));
    assert.equal((r.document.querySelector('input[type=checkbox]') as HTMLInputElement).checked, false, 'a new version needs its own acknowledgement');
    assert.equal(admitDisabled(r), true);
    await r.click(r.document.querySelector('input[type=checkbox]')!);
    await r.click(r.getByText('Admit learning'));
    const admit = posts(r).find((c) => String(c.path).endsWith('/admit'))!;
    assert.match(body(admit), /"typedDigest":"e{64}","previewId":"p1","acknowledgeKnownGoodBlocks":true/);
  } finally { r.cleanup(); }
});

test('category-wide scope needs its own confirmation, and sends it', async () => {
  const p = payload(candidate({ scope: 'category_wide' }));
  const r = await mount(p, (path) => (String(path).endsWith('/admit') ? { ok: true, ruleVersionId: RV } : p));
  try {
    await r.click(r.getByText('Review & admit'));
    assert.ok(r.getByText(/Confirm the category-wide scope/));
    assert.equal(admitDisabled(r), true);
    await r.click(r.document.querySelector('input[type=checkbox]')!);
    await r.click(r.getByText('Admit learning'));
    assert.match(body(posts(r)[0]), /"confirmCategoryWide":true/);
  } finally { r.cleanup(); }
});

test('without a preview of THIS version, the trainer runs one first', async () => {
  const p = payload(candidate({ preview: null }));
  const r = await mount(p, (path) => (String(path).endsWith('/preview') ? { ok: true } : p));
  try {
    await r.click(r.getByText('Review & admit'));
    assert.equal(admitDisabled(r), true);
    await r.click(r.getByText('Run preview'));
    const w = posts(r);
    assert.equal(w[0].path, `/api/v2/agents/video%2Fagent/learning-influence/typed/${CAND}/preview`);
    assert.equal(body(w[0]), JSON.stringify({ typedDigest: 'd'.repeat(64) }));
  } finally { r.cleanup(); }
});

test('a reword follows the NEW candidate id: its preview, and the modal, target the replacement', async () => {
  let current = payload(candidate());
  const r = await mount(current, (path) => {
    if (String(path).endsWith('/edit')) {
      current = payload(candidate({ candidateId: CAND2, candidateKey: 'b'.repeat(64), typedDigest: 'f'.repeat(64),
        text: 'labels must never appear before their narration ends' }));
      return { ok: true, candidateId: CAND2, typedDigest: 'f'.repeat(64), replacedCandidateId: CAND };
    }
    if (String(path).endsWith('/admit')) return { ok: true, ruleVersionId: RV };
    return current;
  });
  try {
    await r.click(r.getByText('Review & admit'));
    await typeText(r, 'labels must never appear before their narration ends');
    await r.click(r.getByText('Save changes'));
    const w = posts(r);
    assert.equal(w[0].path, `/api/v2/agents/video%2Fagent/learning-influence/typed/${CAND}/edit`);
    assert.equal(body(w[0]), JSON.stringify({ typedDigest: 'd'.repeat(64), edits: { text: 'labels must never appear before their narration ends' } }));
    assert.equal(w[1].path, `/api/v2/agents/video%2Fagent/learning-influence/typed/${CAND2}/preview`);
    assert.equal(body(w[1]), JSON.stringify({ typedDigest: 'f'.repeat(64) }));
    await r.click(r.getByText('Admit learning'));
    const admit = posts(r).find((c) => String(c.path).endsWith('/admit'))!;
    assert.equal(admit.path, `/api/v2/agents/video%2Fagent/learning-influence/typed/${CAND2}/admit`);
    assert.match(body(admit), /"candidateKey":"b{64}","typedDigest":"f{64}"/);
  } finally { r.cleanup(); }
});

test('if the preview of a saved edit fails, the modal still moves to the new version', async () => {
  let current = payload(candidate());
  const r = await mount(current, (path) => {
    if (String(path).endsWith('/edit')) { current = payload(candidate({ typedDigest: 'e'.repeat(64), owningStage: 'build', preview: null })); return { ok: true, candidateId: CAND, typedDigest: 'e'.repeat(64) }; }
    if (String(path).endsWith('/preview')) throw refusal('typed_learning_needs_preview', 503);
    return current;
  });
  try {
    await r.click(r.getByText('Review & admit'));
    await choose(r, { Stage: 'build' });
    await r.click(r.getByText('Save changes'));
    assert.ok(r.getByText(/Run the preview for this exact version first/));
    assert.equal(admitDisabled(r), true, 'the old version can no longer be admitted from this modal');
  } finally { r.cleanup(); }
});

test('a stale refusal reloads, shows plain words, and the trainer acts on the latest version', async () => {
  let current = payload(candidate());
  const r = await mount(current, (path) => {
    if (String(path).endsWith('/admit') && body({ init: { body: {} } }) && current.candidates[0].typedDigest === 'd'.repeat(64)) {
      current = payload(candidate({ typedDigest: 'c'.repeat(64) }));
      throw refusal('stale_typed_candidate');
    }
    if (String(path).endsWith('/admit')) return { ok: true, ruleVersionId: RV };
    return current;
  });
  try {
    await r.click(r.getByText('Review & admit'));
    const before = gets(r).length;
    await r.click(r.getByText('Admit learning'));
    assert.ok(r.getByText(/This learning changed since you opened it/));
    assert.equal(r.queryByText(/stale_typed_candidate/), null, 'no raw codes');
    assert.ok(gets(r).length > before, 'the panel reloaded');
    await r.click(r.getByText('Admit learning'));
    const admits = posts(r).filter((c) => String(c.path).endsWith('/admit'));
    assert.match(body(admits[1]), /"typedDigest":"c{64}"/);
  } finally { r.cleanup(); }
});

test('dismiss takes a second click and sends the candidate key', async () => {
  const p = payload();
  const r = await mount(p);
  try {
    await r.click(r.getByText('Review & admit'));
    await r.click(r.getByText('Dismiss'));
    assert.equal(posts(r).length, 0, 'the first click only asks for confirmation');
    await r.click(r.getByText('Confirm dismiss (final)'));
    assert.equal(posts(r)[0].path, `/api/v2/agents/video%2Fagent/learning-influence/candidates/${CAND}/dismiss`);
    assert.equal(body(posts(r)[0]), JSON.stringify({ candidateKey: 'a'.repeat(64) }));
  } finally { r.cleanup(); }
});

test('evidence opens in a tab created inside the click; an untrusted URL closes it', async () => {
  for (const [signedUrl, opened] of [['https://store.example/r/x.png', true], ['javascript:alert(1)', false], ['http://evil.example/x', false]] as const) {
    const p = payload();
    const r = await mount(p, (path) => (String(path).includes('/evidence/') ? { ok: true, signedUrl } : p));
    const tab = { opener: 'self' as unknown, closed: false, location: { href: 'about:blank' }, close() { this.closed = true; } };
    const calls: unknown[][] = [];
    (r.window as unknown as { open: (...a: unknown[]) => unknown }).open = (...a: unknown[]) => { calls.push(a); return tab; };
    try {
      await r.click(r.getByText('Review & admit'));
      await r.click(r.getByText('Open'));
      assert.deepEqual(calls[0], ['about:blank', '_blank'], 'opened synchronously, before the URL is fetched');
      assert.equal(tab.opener, null);
      assert.equal(tab.location.href === signedUrl, opened, signedUrl);
      assert.equal(tab.closed, !opened);
    } finally { r.cleanup(); }
  }
});

test('admitted learnings say where they WILL go and that delivery is not built', async () => {
  const rule = { ruleId: 'r', ruleVersionId: RV, version: 1, state: 'active', text: 'calmer transitions in data scenes', learningType: 'taste',
    owningStage: 'build', category: 'pacing', scope: 'agent', evidenceIds: [EV], activation: { target: 'per_run_snapshot' } };
  const r = await mount({ ok: true, candidates: [], rules: [rule] });
  try { assert.ok(r.getByText(/Will go into each run’s taste snapshot \(not yet delivered to runs\)/)); } finally { r.cleanup(); }
});

test('a backend without typed learnings gets one quiet line and no actions', async () => {
  const r = await render('typed-learnings-panel.tsx', { slug: 'video-agent' },
    { backend: () => { throw refusal('learning influence unavailable', 503); } });
  try {
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(r.getByText(/Typed learnings are not available on this backend yet/));
    assert.equal(r.queryByText('Draft from a Review issue'), null);
    assert.equal(r.document.querySelector('[class*="amber"]'), null, 'no warning box on every agent');
  } finally { r.cleanup(); }
});

test('if a reload shows the open learning was dismissed elsewhere, it can no longer be admitted', async () => {
  let current = payload(candidate());
  const r = await mount(current, (path) => {
    if (String(path).endsWith('/admit')) { current = payload(candidate({ dismissed: true })); throw refusal('typed_candidate_dismissed'); }
    return current;
  });
  try {
    await r.click(r.getByText('Review & admit'));
    await r.click(r.getByText('Admit learning'));
    assert.ok(r.getByText(/This suggestion was dismissed or replaced/));
    assert.equal(admitDisabled(r), true);
  } finally { r.cleanup(); }
});
