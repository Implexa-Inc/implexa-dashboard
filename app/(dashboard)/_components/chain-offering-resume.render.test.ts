import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';
import { parseChainOffering } from '../../../lib/agent-chain-offerings.ts';
import fixture from '../../../test-fixtures/generated/marketplace-chain-offering.v1.json' with { type: 'json' };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function offering(resume: unknown) {
  const parsed = parseChainOffering(clone(resume));
  assert.equal(parsed.status, 'ready', parsed.status === 'unavailable' ? parsed.reason : '');
  return parsed.status === 'ready' ? parsed.offering : (undefined as never);
}

test('the resume renders the ordered chain with per-component evidence and every disclosure', async () => {
  const rendered = await render('chain-offering-resume.tsx', { offering: offering(fixture.resumes.grantedBuyer) });
  try {
    const text = rendered.text();
    assert.match(text, /Agent chain/);
    assert.match(text, /Private preview/);
    // Ordered chain, explained.
    assert.match(text, /Step 1/); assert.match(text, /Step 2/);
    assert.match(text, /Visual Treatment Planner/); assert.match(text, /Remotion Compositor/);
    assert.match(text, /prepares the project_bundle/);
    assert.match(text, /delivers the video master/);
    assert.match(text, /If Step 1 does not succeed, Step 2 never runs and remaining reservations are released/);
    // Required input + local-paths promise, before anything can start.
    assert.match(text, /Presenter recording · required/);
    assert.match(text, /Local paths are never sent to the server/);
    // Zero-default provider posture and credit policy.
    assert.match(text, /Zero provider calls and zero provider spend by default/);
    assert.match(text, /Up to 100 credits per production/);
    assert.match(text, /allocated 30% of the ceiling/);
    // Buyer-owned boundary.
    assert.match(text, /your organization('|’)s own connections and credentials/i);
    // Evidence: both axes, truthful states, no blending.
    assert.match(text, /Builder training/); assert.match(text, /Neutral benchmark/);
    assert.match(text, /Customer field/); assert.match(text, /Personal fit/);
    assert.match(text, /not measured/);
    assert.match(text, /Implexa does not combine them into a score, rating, or rank/);
    // Acquired state: history language + start affordance, no acquire button.
    assert.match(text, /removes access, not history/);
    assert.ok(rendered.queryByText('Start a production'));
    assert.equal(rendered.queryByText('Use this chain'), null);
  } finally { rendered.cleanup(); }
});

test('an unacquired publisher view offers acquisition pinned to the exact version and digest', async () => {
  const rendered = await render('chain-offering-resume.tsx', { offering: offering(fixture.resumes.publisher) });
  try {
    const use = rendered.getByText('Use this chain');
    await rendered.click(use);
    const call = rendered.calls.backend[0];
    assert.match(call.path, /\/api\/v2\/agents\/discovery\/chains\/youtube-video-from-presenter-recording\/acquire$/);
    const body = (call.init as { body: { offeringVersionId: string; offeringDigest: string; idempotencyKey: string } }).body;
    assert.equal(body.offeringDigest, fixture.offering.digest, 'acquisition consents to the exact composition digest');
    assert.ok(body.idempotencyKey.length >= 8);
  } finally { rendered.cleanup(); }
});

test('a double click cannot acquire twice and a retry reuses the first idempotency key', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const rendered = await render('chain-offering-resume.tsx', { offering: offering(fixture.resumes.publisher) }, {
    backend: async () => { await pending; return { ok: true }; },
  });
  try {
    const use = rendered.getByText('Use this chain');
    await rendered.act(() => { (use as HTMLButtonElement).click(); (use as HTMLButtonElement).click(); });
    assert.equal(rendered.calls.backend.length, 1, 'a synchronous double click issues once');
  } finally { release(); rendered.cleanup(); }
});

test('removal requires explicit confirmation and never claims history deletion', async () => {
  const rendered = await render('chain-offering-resume.tsx', { offering: offering(fixture.resumes.grantedBuyer) });
  try {
    const remove = rendered.getByText('Remove chain') as HTMLButtonElement;
    assert.equal(remove.disabled, true, 'removal is disabled until confirmed');
    const checkbox = rendered.document.querySelector('input[type="checkbox"]')!;
    await rendered.click(checkbox);
    assert.equal(remove.disabled, false);
    await rendered.click(remove);
    assert.match(rendered.calls.backend[0].path, /\/uninstall$/);
    assert.doesNotMatch(rendered.text(), /delete(s|d)? (your )?(runs|history|receipts)/i);
  } finally { rendered.cleanup(); }
});

test('a withheld personal fit renders the privacy explanation and no numbers', async () => {
  // The backend withholds personal fit for anonymous viewers. Neither fixture
  // resume is anonymous, so build the withheld form explicitly — the parser
  // accepts it, and the card must explain rather than count.
  const withheld = clone(fixture.resumes.grantedBuyer);
  for (const node of withheld.orderedChain) {
    (node as { evidenceChannels: { channels: Record<string, unknown> } }).evidenceChannels.channels.personalFit = { status: 'unavailable' };
  }
  const rendered = await render('chain-offering-resume.tsx', { offering: offering(withheld) });
  try {
    const text = rendered.text();
    assert.match(text, /Sign in to see your own evidence\. It stays private to your organization\./);
    // Exact-match the card headings; queryAllByText also returns ancestors
    // whose textContent merely contains the phrase.
    const fitCards = [...rendered.document.querySelectorAll('li p')]
      .filter((node) => node.textContent === 'Personal fit')
      .map((heading) => heading.closest('li')!.textContent || '');
    assert.equal(fitCards.length, 2);
    for (const card of fitCards) {
      assert.doesNotMatch(card, /\d+ runs?|none yet|not measured/, 'a withheld fit shows no counts at all');
    }
  } finally { rendered.cleanup(); }
});

test('no organization id, creator path, or credential reaches the rendered resume', async () => {
  const rendered = await render('chain-offering-resume.tsx', { offering: offering(fixture.resumes.grantedBuyer) });
  try {
    const text = rendered.text();
    assert.doesNotMatch(text, /\/Users\/|\/home\/|sk_(live|test)_|whsec_|ghp_/);
    assert.doesNotMatch(text, /[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/i, 'no synthetic org/user identity leaks');
  } finally { rendered.cleanup(); }
});
