import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const actions = fs.readFileSync(path.join(import.meta.dirname, 'agent-actions.tsx'), 'utf8');
const page = fs.readFileSync(path.join(import.meta.dirname, '..', 'workflows', '[slug]', 'page.tsx'), 'utf8');

test('a waiting agent update cannot silently launch the installed version', () => {
  assert.match(page, /pendingUpdate=\{workflow\.update_available \?/,
    'both Run surfaces must know that a newer version is waiting');
  assert.match(actions, /Agent update v\{pendingUpdate\.version\} is waiting for activation/);
  assert.match(actions, /Run the installed version instead of update v\{pendingUpdate\.version\}/);
  assert.match(actions, /!!pendingUpdate && !runInstalledVersionConfirmed/,
    'the primary action stays disabled until the old-version choice is explicit');
  assert.match(actions, /allowSupersededInstalledVersion: true/,
    'the explicit acknowledgement must cross the backend boundary');
  assert.match(actions, /!revisePending && !pendingUpdate && blocking === 0/,
    'the unqueued watch path must not bypass the server-enforced version choice');
});
