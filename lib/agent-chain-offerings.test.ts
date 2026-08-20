import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChainOffering } from './agent-chain-offerings.ts';
import fixture from '../test-fixtures/generated/marketplace-chain-offering.v1.json' with { type: 'json' };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const buyerResume = () => clone(fixture.resumes.grantedBuyer);

function ready(value: unknown) {
  const parsed = parseChainOffering(value);
  assert.equal(parsed.status, 'ready', parsed.status === 'unavailable' ? parsed.reason : '');
  return parsed.status === 'ready' ? parsed.offering : (undefined as never);
}
function refused(value: unknown, why: string) {
  const parsed = parseChainOffering(value);
  assert.equal(parsed.status, 'unavailable', why);
}

test('the backend-generated resumes parse for both published viewers', () => {
  for (const [viewer, resume] of Object.entries(fixture.resumes)) {
    const offering = ready(clone(resume));
    assert.equal(offering.slug, 'youtube-video-from-presenter-recording', viewer);
    assert.equal(offering.orderedChain.length, 2, viewer);
  }
});

test('the whole pre-start disclosure surface survives parsing', () => {
  const offering = ready(buyerResume());
  assert.equal(offering.privatePreview, true);
  assert.deepEqual(offering.orderedChain.map((node) => node.role), ['generator', 'primary']);
  assert.equal(offering.handoffKind, 'project_bundle');
  assert.equal(offering.requiredInput.key, 'presenter_video');
  assert.match(offering.requiredInput.disclosure, /Local paths are never sent to the server/);
  assert.equal(offering.finalArtifactKind, 'video_master');
  assert.equal(offering.consequentialCeiling.zeroDefault, true);
  assert.equal(offering.consequentialCeiling.maxProviderCalls, 0);
  assert.equal(offering.creditPolicy.maxTotalCredits, 100);
  assert.match(offering.historyLanguage, /removes access, not history/);
  assert.equal(offering.acquisition?.lifecycle, 'installed');
  // Per-component evidence made it through the evidence parser.
  assert.equal(offering.orderedChain[0].evidenceChannels.builderTraining.status, 'evidence_available');
  assert.equal(offering.orderedChain[0].evidenceChannels.neutralBenchmark.status, 'unknown');
});

test('a malformed component evidence projection withholds the whole offering', () => {
  const poisoned = buyerResume();
  (poisoned.orderedChain[0] as { evidenceChannels: Record<string, unknown> }).evidenceChannels = {
    contractVersion: 'marketplace-evidence-channels.v1',
    channels: { builderTraining: { status: 'evidence_available' } },
  };
  refused(poisoned, 'invented component evidence must never render');
});

test('a fabricated zero-default over non-zero ceilings is refused', () => {
  const lying = buyerResume();
  (lying.consequentialCeiling as { maxProviderCalls: number }).maxProviderCalls = 3;
  refused(lying, 'zeroDefault is derived; asserting it over non-zero ceilings lies about consequences');
});

test('a chain missing its disclosures is not renderable', () => {
  const noDisclosure = buyerResume();
  (noDisclosure.requiredInput as { disclosure: string }).disclosure = 'Upload your file.';
  refused(noDisclosure, 'the local-paths promise is load-bearing');
  const noHistory = buyerResume();
  (noHistory as { historyLanguage: string }).historyLanguage = 'Uninstalling deletes everything.';
  refused(noHistory, 'the history-preservation language is load-bearing');
  const wrongHandoff = buyerResume();
  (wrongHandoff as { handoffKind: string }).handoffKind = 'zip';
  refused(wrongHandoff, 'the typed handoff is part of the contract');
  const wrongArtifact = buyerResume();
  (wrongArtifact as { finalArtifactKind: string }).finalArtifactKind = 'blog_post';
  refused(wrongArtifact, 'the final artifact kind is part of the contract');
});

test('a partial or reordered chain is refused', () => {
  const oneNode = buyerResume();
  (oneNode as { orderedChain: unknown[] }).orderedChain = [oneNode.orderedChain[0]];
  refused(oneNode, 'a partial chain must never render as whole');
  const swapped = buyerResume();
  (swapped as { orderedChain: unknown[] }).orderedChain = [swapped.orderedChain[1], swapped.orderedChain[0]];
  refused(swapped, 'order is the contract: generator then primary');
  // Rewriting the ordinals to match their new positions must not smuggle a
  // role swap past the parser: the role check has to hold on its own.
  const rolesSwapped = buyerResume();
  (rolesSwapped.orderedChain[0] as { role: string }).role = 'primary';
  (rolesSwapped.orderedChain[1] as { role: string }).role = 'generator';
  refused(rolesSwapped, 'a compositor cannot present itself as the planner');
  const duplicated = buyerResume();
  (duplicated.orderedChain[1] as { version: { id: string } }).version.id = (duplicated.orderedChain[0] as { version: { id: string } }).version.id;
  refused(duplicated, 'one component playing both roles is not the offering');
});

test('an unsupported contract version and a leaked path are both refused', () => {
  const versioned = buyerResume();
  (versioned as { contractVersion: string }).contractVersion = 'marketplace-chain-offering.v2';
  refused(versioned, 'a later contract version is not this one');
  const leaky = buyerResume();
  (leaky.orderedChain[0] as { limitations: string }).limitations = 'Reads /Users/creator/workspace/render.js';
  refused(leaky, 'a creator path must never reach the buyer');
});

test('producer-impossible admission, mode, engine, and evidence states are refused', () => {
  const blocked = buyerResume();
  (blocked as { admission: string }).admission = 'blocked';
  (blocked as { privatePreview: boolean }).privatePreview = false;
  refused(blocked, 'blocked offerings never reach the wire');
  const contradictoryPreview = buyerResume();
  (contradictoryPreview as { privatePreview: boolean }).privatePreview = false;
  refused(contradictoryPreview, 'private-preview admission derives the preview marker');
  const unknownMode = buyerResume();
  (unknownMode as { qualityModes: string[] }).qualityModes = ['bestest'];
  refused(unknownMode, 'quality modes are a closed v1 vocabulary');
  const unknownEngine = buyerResume();
  (unknownEngine as { supportedEngines: string[] }).supportedEngines = ['arc'];
  refused(unknownEngine, 'execution engines are a closed v1 vocabulary');
  const wrongEvidenceVersion = buyerResume();
  (wrongEvidenceVersion as { evidenceContractVersion: string }).evidenceContractVersion = 'marketplace-evidence-channels.v2';
  refused(wrongEvidenceVersion, 'a later evidence contract is not implicitly accepted');
});

test('component version authority mirrors the frozen 0181 publication contract', () => {
  const emptyEngines = buyerResume();
  (emptyEngines.orderedChain[0] as { supportedEngines: string[] }).supportedEngines = [];
  refused(emptyEngines, 'a published component always has at least one engine');
  const unknownEngine = buyerResume();
  (unknownEngine.orderedChain[0] as { supportedEngines: string[] }).supportedEngines = ['arc'];
  refused(unknownEngine, 'component engines use the same closed vocabulary as publication');
  const missingVersion = buyerResume();
  (missingVersion.orderedChain[0] as { version: { number: unknown } }).version.number = null;
  refused(missingVersion, 'a published component has an immutable marketplace version');
  const malformedCapability = buyerResume();
  (malformedCapability.orderedChain[0] as { version: { capabilityDigest: string } }).version.capabilityDigest = 'bad';
  refused(malformedCapability, 'capability authority cannot be softened to null');
  const malformedPermission = buyerResume();
  (malformedPermission.orderedChain[0] as { version: { permissionDigest: string } }).version.permissionDigest = 'bad';
  refused(malformedPermission, 'permission authority cannot be softened to null');
});

test('acquisition authority is derived from the exact displayed version and digest', () => {
  const wrongVersion = buyerResume();
  (wrongVersion.acquisition as { offeringVersionId: string }).offeringVersionId = '00000099-0000-4000-8000-000000000099';
  refused(wrongVersion, 'an exact claim cannot move v1 consent to v2');
  const honestUpgrade = buyerResume();
  (honestUpgrade.acquisition as { offeringVersionId: string; authority: string }).offeringVersionId = '00000099-0000-4000-8000-000000000099';
  (honestUpgrade.acquisition as { authority: string }).authority = 'upgrade_required';
  assert.equal(ready(honestUpgrade).acquisition?.authority, 'upgrade_required');
  const wrongDigest = buyerResume();
  (wrongDigest.acquisition as { offeringDigest: string }).offeringDigest = '1'.repeat(64);
  refused(wrongDigest, 'a foreign digest cannot claim exact authority');
});

test('the fixture proves matcher, marker identity, failure gate, and reconciliation', () => {
  for (const phrasing of ['plain', 'marked', 'constrained'] as const) {
    assert.equal(fixture.matcher[phrasing].kind, 'matched');
    assert.equal(fixture.matcher[phrasing].taskKey, 'video.final_master');
    assert.ok(fixture.matcher[phrasing].confidence >= 0.76);
  }
  assert.notEqual(fixture.markerIdentity.markedIntentDigest, fixture.markerIdentity.otherMarkerIntentDigest,
    'a different marker is a different receipt identity');
  assert.equal(fixture.failureGate.onGeneratorFailure, 'blocked_upstream_unsuccessful');
  assert.equal(fixture.failureGate.onGeneratorSuccess, 'ready');
  assert.equal(fixture.creditReconciliation.example.settledCredits, 2);
  assert.equal(fixture.creditReconciliation.example.reservedCreditsAtClose, 0);
  assert.equal(fixture.plan.typedHandoff.expectedKind, 'project_bundle');
  assert.equal(fixture.plan.nodes[1].expected_artifact_kind, 'video_master');
  // Every runtime-only claim names the PostgreSQL suite that proves it.
  for (const key of ['atomicAcquisition', 'previewGrantScoping', 'revocationStopsNewRuns',
    'duplicateProductionIdempotency', 'agentOneFailureReleasesReservations', 'evidenceChannelIntegrity']) {
    assert.match(fixture.provenBy[key as keyof typeof fixture.provenBy], /^scripts\/smoke-.*-postgres\.js$/);
  }
});
