import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';
import generated from '../../../test-fixtures/generated/agent-marketplace-slice1.json' with { type: 'json' };
import channels from '../../../test-fixtures/generated/marketplace-evidence-channels.json' with { type: 'json' };

const CARD_LABELS = ['Builder training', 'Neutral benchmark', 'Customer field', 'Personal fit'];
const TYPE_LABELS = ['Deterministic verification', 'Judge review', 'Human acceptance', 'Certification'];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function agent(evidenceChannels: unknown, extra: Record<string, unknown> = {}) {
  return {
    ...generated.available,
    ownership: 'Available',
    readiness: { state: 'Available', reason: null },
    primaryAction: 'Use agent',
    evidenceChannels,
    ...extra,
  };
}

/** The text of the card whose heading is `label`, so one card's claims can be
 *  asserted without another card's numbers bleeding into the match. */
function card(rendered: { document: Document }, label: string): string {
  const heading = [...rendered.document.querySelectorAll('li p')].find((node) => node.textContent === label);
  assert.ok(heading, `no card titled ${label}`);
  return heading!.closest('li')!.textContent || '';
}

test('four provenance cards render, each keeping the four evidence types separate', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent(channels.canonicalProduction.anonymousViewer) });
  try {
    for (const label of CARD_LABELS) assert.ok(rendered.queryByText(label), `${label} card is missing`);
    const builderTraining = card(rendered, 'Builder training');
    for (const type of TYPE_LABELS) assert.ok(builderTraining.includes(type), `${type} is missing inside Builder training`);
    assert.match(builderTraining, /1 exact-version run(?!s)/);
    assert.match(builderTraining, /Deterministic verification1 run/);
    // The other three types inside the SAME card stay separately truthful.
    assert.match(builderTraining, /Judge reviewnone yet/);
    assert.match(builderTraining, /Human acceptancenone yet/);
    assert.match(builderTraining, /Certificationnot measured/);
  } finally { rendered.cleanup(); }
});

test('unknown and none-yet are different claims, and neither is a score', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent(channels.canonicalProduction.anonymousViewer) });
  try {
    // Neutral benchmark has no authority at all: not measured, not "zero".
    const benchmark = card(rendered, 'Neutral benchmark');
    assert.match(benchmark, /Not measured/);
    assert.match(benchmark, /Implexa has not established a benchmark authority/);
    assert.doesNotMatch(benchmark, /\d+ exact-version run/);
    // Customer field WAS measured and is genuinely empty.
    const customerField = card(rendered, 'Customer field');
    assert.match(customerField, /0 exact-version runs/);
    assert.match(customerField, /Deterministic verificationnone yet/);
    const disclaimer = 'Implexa does not combine them into a score, rating, or rank.';
    assert.match(rendered.text(), /Implexa does not combine them into a score, rating, or rank/);
    // The disclaimer names the forbidden things, so remove it before looking.
    assert.doesNotMatch(rendered.text().replace(disclaimer, ''), /\d+%|\bout of 5\b|★|\brank(ed)?\b|\bscore\b|\brating\b/i);
  } finally { rendered.cleanup(); }
});

test('an anonymous viewer is told personal fit is private, and is shown no numbers for it', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent(channels.canonicalProduction.anonymousViewer) });
  try {
    const personalFit = card(rendered, 'Personal fit');
    assert.match(personalFit, /Sign in to see your own evidence for this version/);
    assert.match(personalFit, /stays private to your organization/);
    assert.doesNotMatch(personalFit, /exact-version run/);
    assert.doesNotMatch(personalFit, /none yet|not measured/);
  } finally { rendered.cleanup(); }
});

test('a foreign viewer sees an empty personal fit and never another buyer evidence', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent(channels.afterIndependentUserTest.foreignViewer) });
  try {
    const personalFit = card(rendered, 'Personal fit');
    assert.match(personalFit, /0 exact-version runs/);
    assert.match(personalFit, /Deterministic verificationnone yet/);
    // The buyer's run is public field evidence; it is never the viewer's own.
    assert.match(card(rendered, 'Customer field'), /1 exact-version run(?!s)/);
  } finally { rendered.cleanup(); }
});

test("a buyer's own private acceptance appears only in their personal fit card", async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent(channels.withPrivateBuyerAcceptance.buyerViewer) });
  try {
    assert.match(card(rendered, 'Personal fit'), /Human acceptance1 run/);
    assert.match(card(rendered, 'Customer field'), /Human acceptancenone yet/);
    assert.match(card(rendered, 'Builder training'), /Human acceptancenone yet/);
    assert.match(card(rendered, 'Personal fit'), /Private to you/);
    assert.doesNotMatch(rendered.text(), /shared with|visible to everyone|public fit/i);
  } finally { rendered.cleanup(); }
});

test('the publisher view keeps owner controls and its own builder evidence', async () => {
  const rendered = await render('agent-resume.tsx', {
    agent: agent(channels.canonicalProduction.publisherViewer, { ownership: 'Owned', acquisition: null }),
  });
  try {
    assert.match(card(rendered, 'Builder training'), /1 exact-version run(?!s)/);
    assert.match(card(rendered, 'Personal fit'), /0 exact-version runs/, 'a publisher is not their own customer');
    assert.ok(rendered.queryByText('Configure')); assert.ok(rendered.queryByText('Train'));
    assert.ok(rendered.getByText('Finish setup'));
  } finally { rendered.cleanup(); }
});

test('a reversed channel drops to none yet while its run count is preserved', async () => {
  const reversed = clone(channels.afterIndependentUserTest.anonymousViewer);
  const customerField = reversed.channels.customerField as {
    status: string; evidence: Record<string, { status: string; count: number }>; latestEvidenceAt: string | null;
  };
  customerField.status = 'insufficient_evidence';
  customerField.latestEvidenceAt = null;
  for (const type of ['deterministicVerification', 'judgeReview', 'humanAcceptance']) customerField.evidence[type] = { status: 'insufficient_evidence', count: 0 };
  const rendered = await render('agent-resume.tsx', { agent: agent(reversed) });
  try {
    const rendered_customerField = card(rendered, 'Customer field');
    // The run still happened; only its favorable evidence was reversed.
    assert.match(rendered_customerField, /1 exact-version run(?!s)/);
    assert.match(rendered_customerField, /Deterministic verificationnone yet/);
    assert.match(card(rendered, 'Builder training'), /Deterministic verification1 run/, 'one channel reversing never reverses another');
  } finally { rendered.cleanup(); }
});

test('a version with no evidence at all renders four honest empty cards, not an error', async () => {
  const empty = clone(channels.canonicalProduction.anonymousViewer);
  const builderTraining = empty.channels.builderTraining as {
    status: string; exactVersionRunCount: number; latestEvidenceAt: string | null; evidence: Record<string, { status: string; count: number }>;
  };
  builderTraining.status = 'insufficient_evidence';
  builderTraining.exactVersionRunCount = 0;
  builderTraining.latestEvidenceAt = null;
  builderTraining.evidence.deterministicVerification = { status: 'insufficient_evidence', count: 0 };
  const rendered = await render('agent-resume.tsx', { agent: agent(empty) });
  try {
    assert.doesNotMatch(rendered.text(), /Evidence by source is unavailable/);
    for (const label of CARD_LABELS) assert.ok(rendered.queryByText(label));
    assert.match(card(rendered, 'Builder training'), /0 exact-version runs/);
  } finally { rendered.cleanup(); }
});

test('switching to another exact version replaces the evidence instead of mixing it', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent(channels.afterIndependentUserTest.buyerViewer) });
  try {
    assert.match(card(rendered, 'Customer field'), /1 exact-version run(?!s)/);
    assert.match(card(rendered, 'Personal fit'), /Judge review1 run/);
    await rendered.rerender({ agent: agent(channels.canonicalProduction.anonymousViewer, { version: { ...generated.available.version, id: 'other-version', number: '2.0.0' } }) });
    // Nothing from the previous version survives the switch.
    assert.match(card(rendered, 'Customer field'), /0 exact-version runs/);
    assert.match(card(rendered, 'Personal fit'), /Sign in to see your own evidence/);
    assert.doesNotMatch(rendered.text(), /Judge review1 run/);
  } finally { rendered.cleanup(); }
});

test('a projection for a different contract version is refused without blanking the resume', async () => {
  const mixed = { ...clone(channels.canonicalProduction.anonymousViewer), contractVersion: 'marketplace-evidence-channels.v2' };
  const rendered = await render('agent-resume.tsx', { agent: agent(mixed) });
  try {
    assert.match(rendered.text(), /Evidence by source is unavailable for this version/);
    assert.match(rendered.text(), /unsupported contract version/);
    for (const label of CARD_LABELS) assert.equal(rendered.queryByText(label), null);
    // Everything else the resume promises is still there.
    assert.match(rendered.text(), /What it can and cannot do/);
    assert.match(rendered.text(), /Tested compatibility/);
    assert.match(rendered.text(), /Required inputs/);
    assert.match(rendered.text(), /Integrations and permissions/);
    assert.ok(rendered.getByText('Use agent'));
  } finally { rendered.cleanup(); }
});

test('an absent projection is unavailable, and required-input safety copy is untouched', async () => {
  const rendered = await render('agent-resume.tsx', {
    agent: agent(undefined, {
      requiredInputs: { version: 1, fields: [{ key: 'source', label: 'Source file', description: 'The file to read', kind: 'file', required: true }] },
      readiness: { state: 'Needs setup', reason: 'Required integrations have not been verified.' },
      primaryAction: 'Finish setup',
    }),
  });
  try {
    assert.match(rendered.text(), /Evidence by source is unavailable for this version/);
    assert.match(rendered.text(), /did not publish channel evidence/);
    assert.match(rendered.text(), /Local paths are never sent to the server/);
    assert.match(rendered.text(), /Source file · required/);
  } finally { rendered.cleanup(); }
});

test('no raw identity, path, credential or prompt reaches the rendered resume', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent(channels.withPrivateBuyerAcceptance.buyerViewer) });
  try {
    const evidence = [...rendered.document.querySelectorAll('li')].map((node) => node.textContent || '').join('\n');
    assert.doesNotMatch(evidence, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    assert.doesNotMatch(evidence, /\/Users\/|\/home\/|sk_live_|whsec_|@[a-z0-9-]+\.[a-z]{2,}/i);
  } finally { rendered.cleanup(); }
});
