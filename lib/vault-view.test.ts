// node --test via scripts/run-tests.mjs (Node strips the types natively)
//
// The honesty rules of /settings/local-vault, as behavior:
//
//   1. ABSENT METHOD ≠ FAILED CALL — an old app gets a calm fallback; a
//      rejected call renders "don't know", NEVER "ready"/"saved"/"missing".
//      (The founder hit exactly this collapse on the activation key row.)
//   2. UNREACHABLE ≠ UNAVAILABLE — a rejected availability check ('error',
//      couldn't ask) is a different state with a different fix than an answered
//      "this Mac can't store keys" ('unavailable'). Same rule as the broker's
//      empty-socket-reply ≠ ACL-denial.
//   3. A failed key list must never claim "No key saved" — that copy invites a
//      re-paste, and keys:set OVERWRITES the stored value.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVaultMode, deriveProviderCards, allowCandidates, relativeTime } from './vault-view.ts';

const REGISTRY = [
  { provider: 'runway', label: 'Runway', scope: 'video generation' },
  { provider: 'elevenlabs', label: 'ElevenLabs', scope: 'speech generation' },
];

test('rule 1: no bridge = web (calm); missing method = unsupported (calm); rejected call = error — three distinct states', () => {
  const base = { mounted: true, hasBridge: true, hasKeysAvailable: true, availableResult: null, checkFailed: false };
  assert.equal(deriveVaultMode({ ...base, hasBridge: false }), 'web');
  assert.equal(deriveVaultMode({ ...base, hasKeysAvailable: false }), 'unsupported');
  assert.equal(deriveVaultMode({ ...base, checkFailed: true }), 'error');
  assert.notEqual(deriveVaultMode({ ...base, checkFailed: true }), 'ready',
    'a rejected check must never read as ready');
});

test("rule 2: an answered 'no' is 'unavailable', a rejected ask is 'error' — different fixes, never merged", () => {
  const base = { mounted: true, hasBridge: true, hasKeysAvailable: true, checkFailed: false };
  assert.equal(deriveVaultMode({ ...base, availableResult: false }), 'unavailable');
  assert.equal(deriveVaultMode({ ...base, availableResult: true }), 'ready');
  assert.notEqual(
    deriveVaultMode({ ...base, availableResult: false }),
    deriveVaultMode({ ...base, availableResult: null, checkFailed: true }),
  );
});

test("rule 3: a failed list renders every card 'unknown' — never 'missing' (which invites an overwriting re-paste)", () => {
  const cards = deriveProviderCards({ registry: REGISTRY, listed: null, listFailed: true, configuredFallback: null });
  for (const c of cards) {
    assert.equal(c.state, 'unknown');
    assert.equal(c.canManageAccess, false);
  }
});

test('a healthy list yields saved-with-metadata vs missing, both manageable', () => {
  const cards = deriveProviderCards({
    registry: REGISTRY,
    listed: [{
      provider: 'runway', label: 'Runway', configuredAt: '2026-07-18T00:00:00Z',
      lastUsedAt: '2026-07-20T00:00:00Z', grantedAgents: ['reel-agent'],
      grants: [{ agentSlug: 'reel-agent', grantedAt: '2026-07-18T00:00:00Z', lastUsedAt: '2026-07-20T00:00:00Z' }],
    }],
    listFailed: false,
    configuredFallback: null,
  });
  const runway = cards.find((c) => c.provider === 'runway')!;
  assert.equal(runway.state, 'saved');
  assert.equal(runway.savedAt, '2026-07-18T00:00:00Z');
  assert.equal(runway.grants.length, 1);
  assert.equal(runway.canManageAccess, true);
  const eleven = cards.find((c) => c.provider === 'elevenlabs')!;
  assert.equal(eleven.state, 'missing');
  assert.equal(eleven.canManageAccess, true, 'missing on a HEALTHY read is actionable (Add key)');
});

test('older app (listKeys absent): keysConfigured booleans still answer saved/missing, but access management is off', () => {
  const cards = deriveProviderCards({
    registry: REGISTRY, listed: null, listFailed: false,
    configuredFallback: { runway: true, elevenlabs: false },
  });
  assert.equal(cards.find((c) => c.provider === 'runway')!.state, 'saved');
  assert.equal(cards.find((c) => c.provider === 'elevenlabs')!.state, 'missing');
  for (const c of cards) assert.equal(c.canManageAccess, false, 'no per-grant truth on an old app — never fake an access list');
});

test('legacy grantedAgents-only rows (no grants array) still produce an access list', () => {
  const cards = deriveProviderCards({
    registry: REGISTRY,
    listed: [{ provider: 'runway', label: 'Runway', configuredAt: null, grantedAgents: ['a', 'b'] }],
    listFailed: false, configuredFallback: null,
  });
  assert.deepEqual(cards.find((c) => c.provider === 'runway')!.grants.map((g) => g.agentSlug), ['a', 'b']);
});

test('allowCandidates offers only not-yet-granted agents', () => {
  const out = allowCandidates(
    [{ slug: 'reel-agent', name: 'Reel' }, { slug: 'thumb-agent', name: 'Thumbs' }],
    [{ agentSlug: 'reel-agent', grantedAt: null, lastUsedAt: null }],
  );
  assert.deepEqual(out.map((a) => a.slug), ['thumb-agent']);
});

test('relativeTime is honest about garbage input', () => {
  const now = Date.parse('2026-07-20T12:00:00Z');
  assert.equal(relativeTime('2026-07-20T11:00:00Z', now), '1h ago');
  assert.equal(relativeTime(null, now), null);
  assert.equal(relativeTime('not-a-date', now), null);
});
