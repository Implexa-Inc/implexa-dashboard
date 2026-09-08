import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAuthorityDelta } from './agent-authority-delta.ts';

test('permission groups are described in what the agent can DO, not by their key', () => {
  const described = describeAuthorityDelta({ added: { permission_groups: ['shell', 'send'] } });
  assert.equal(described.hasChanges, true);
  assert.deepEqual(described.added, ['run commands on your computer', 'send or post on your behalf']);
  assert.deepEqual(described.removed, []);
});

test('AN UNRECOGNIZED MEMBER IS SHOWN VERBATIM, NEVER DROPPED', () => {
  // A capability with no phrasing is still a capability the agent gained.
  // Omitting it would make the diff wrong in precisely the case that matters —
  // something new that nobody has thought about yet.
  const described = describeAuthorityDelta({
    added: { capabilities: ['quantum_teleport'], permission_groups: ['telepathy'], destructive: ['obliterate'] },
  });
  assert.deepEqual(described.added, [
    'capability: quantum_teleport', 'permission: telepathy', 'authority: obliterate',
  ]);
});

test('a spend ceiling is described with its amount AND its currency', () => {
  const usd = describeAuthorityDelta({ added: { spend: { 'runway:USD': { from: 0, to: 5000 } } } });
  assert.deepEqual(usd.added, ['spend up to $50.00 per run on runway']);
  const raised = describeAuthorityDelta({ added: { spend: { 'runway:USD': { from: 250, to: 5000 } } } });
  assert.deepEqual(raised.added, ['spend up to $50.00 per run on runway (was $2.50)']);
  const other = describeAuthorityDelta({ added: { spend: { 'openai:EUR': { from: 0, to: 100 } } } });
  assert.deepEqual(other.added, ['spend up to 1.00 EUR per run on openai']);
});

test('a lowered ceiling reads as a give-up, not a gain', () => {
  const described = describeAuthorityDelta({ removed: { spend: { 'runway:USD': { from: 5000, to: 250 } } } });
  assert.deepEqual(described.removed, ['spend limit on runway lowered to $2.50']);
  assert.deepEqual(described.added, []);
});

test('accounts, secrets, providers and machines carry a prefix that says what they are', () => {
  const described = describeAuthorityDelta({
    added: {
      accounts: ['rabi@evabot.ai'],
      secrets: ['api_credential:runway'],
      providers: ['runway'],
      machines: ['transport:remote_https'],
    },
  });
  assert.deepEqual(described.added, [
    'access the account rabi@evabot.ai',
    'use the credential api_credential:runway',
    'use the paid provider runway',
    'run on transport:remote_https',
  ]);
});

test('an empty, null or undefined delta reports no changes so no panel renders', () => {
  for (const value of [null, undefined, {}, { added: {}, removed: {} }, { added: null, removed: null }]) {
    const described = describeAuthorityDelta(value);
    assert.equal(described.hasChanges, false, `expected no changes for ${JSON.stringify(value)}`);
    assert.deepEqual(described.added, []);
    assert.deepEqual(described.removed, []);
  }
});

test('gains and give-ups are reported separately, so a reduction is never shown as a gain', () => {
  const described = describeAuthorityDelta({
    added: { permission_groups: ['shell'] },
    removed: { permission_groups: ['web'] },
  });
  assert.deepEqual(described.added, ['run commands on your computer']);
  assert.deepEqual(described.removed, ['read web pages']);
});
