import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, 'activation-card.tsx'), 'utf8');

test('required high-trust access is visibly agent-scoped and blocks the activation CTA', () => {
  assert.match(src, /Grant once to this agent\. It stays available for its future runs until you revoke it\./);
  assert.match(src, /Allow for this agent/);
  assert.match(src, /This agent cannot deliver its final output without the highlighted permission/);
  assert.match(src, /\) : !allLocalGranted \? \(/,
    'the required-permission branch must precede the Activate branch');
});

test('bottom required-permission CTA grants instead of only focusing another control', () => {
  assert.match(src, /function allowFirstRequiredPermission\(\)/);
  assert.match(src, /toggleOptIn\(missing\.group, true\)/,
    'the large CTA must actually grant the first missing required permission');
  assert.match(src, /onClick=\{allowFirstRequiredPermission\}/,
    'the visible "Allow required permission" button must use the grant helper');
  assert.doesNotMatch(src, /onClick=\{focusRequiredPermission\}/,
    'the bottom CTA must not be a focus-only no-op');
});

test('permissions row reflects a local required grant immediately', () => {
  assert.match(src, /permissionLocallyComplete = step\.id === 'permissions'/,
    'the parent row must derive completion from local opt-in state');
  assert.match(src, /const effectiveStatus = permissionLocallyComplete \? 'done' : step\.status/,
    'local completion should flip the row checkmark before the server refresh returns');
  assert.match(src, /<StatusDot status=\{effectiveStatus\} \/>/,
    'the row dot must render the locally-derived status');
});

test('saved permission note is shown inside the permissions section', () => {
  assert.match(src, /permissionNote\?: string \| null/);
  assert.match(src, /permissionNote=\{localGrantNote\}/);
  assert.match(src, /step\.id === 'permissions'[\s\S]{0,260}permissionNote &&/,
    'the confirmation belongs next to the permission controls, not below the fold');
});

test('the remote dashboard never writes a global Claude allowlist', () => {
  assert.doesNotMatch(src, /writeLocalAllowlist/);
  assert.doesNotMatch(src, /grantLocalPermissions\(/);
  assert.match(src, /never widen ~\/\.claude\/settings\.json globally/);
});

test('active-agent grant changes use the dedicated per-agent endpoint', () => {
  assert.match(src, /\/permissions\/\$\{encodeURIComponent\(group\)\}/);
  assert.match(src, /body: \{ granted: on \}/);
  assert.match(src, /Revoked for this agent/);
});
