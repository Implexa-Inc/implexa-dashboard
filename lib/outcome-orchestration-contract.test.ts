// node --test lib/outcome-orchestration-contract.test.ts
//
// The producer/consumer seam. The checked-in fixture must be BYTE-equivalent
// JSON to what the Backend's generator emits — hand-editing the Dashboard copy
// (or letting it drift behind the Backend) fails here, exactly like
// lib/reviewer-resolution-contract.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fixture from '../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = 'scripts/generate-outcome-orchestration-dashboard-fixture.js';

test('checked-in fixture is byte-equivalent JSON to the backend producer', () => {
  const candidates = [
    process.env.IMPLEXA_BACKEND_DIR,
    resolve(root, '../../Implexa-backend-outcome-orchestration'),
    resolve(root, '../implexa-backend'),
  ].filter(Boolean) as string[];
  const backend = candidates.find((dir) => existsSync(resolve(dir, GENERATOR)));
  assert.ok(backend, 'checkout the matching backend PR beside the Dashboard or set IMPLEXA_BACKEND_DIR');

  const out = mkdtempSync(join(tmpdir(), 'implexa-outcome-fixture-'));
  try {
    const generated = spawnSync(process.execPath, [GENERATOR], {
      cwd: backend, encoding: 'utf8', env: { ...process.env, IMPLEXA_DASHBOARD_REPO: out },
    });
    assert.equal(generated.status, 0, generated.stderr);
    const produced = JSON.parse(readFileSync(join(out, 'test-fixtures/generated/outcome-orchestration.json'), 'utf8'));
    assert.deepEqual(produced, fixture);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
