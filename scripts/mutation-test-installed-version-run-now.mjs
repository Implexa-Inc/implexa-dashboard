#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [
  'lib/run-request-receipt.ts',
  'lib/run-request-receipt.test.ts',
  'app/(dashboard)/_components/agent-actions.tsx',
  'app/(dashboard)/_components/agent-update-gate.tsx',
  'app/(dashboard)/_components/agent-update-gate.test.ts',
  'app/(dashboard)/workflows/[slug]/page.tsx',
];
const suites = [
  'lib/run-request-receipt.test.ts',
  'app/(dashboard)/_components/agent-update-gate.test.ts',
];
const mutations = [
  ['rejected-response-treated-as-queued', 'lib/run-request-receipt.ts',
    "return body.ok === true && typeof body.request?.id === 'string' && body.request.id.trim().length > 0",
    "return typeof body.request?.id === 'string' && body.request.id.trim().length > 0"],
  ['missing-request-id-treated-as-queued', 'lib/run-request-receipt.ts',
    "typeof body.request?.id === 'string' && body.request.id.trim().length > 0",
    "typeof body.request?.id === 'string'"],
  ['run-now-skips-confirmed-receipt', 'app/(dashboard)/_components/agent-actions.tsx',
    'const confirmedRequestId = confirmedRunRequestId(res);',
    'const confirmedRequestId = res?.request?.id || null;'],
  ['available-update-gate-removed', 'app/(dashboard)/workflows/[slug]/page.tsx',
    '              {workflow.update_available?.input_contract_digest && (',
    '              {false && workflow.update_available?.input_contract_digest && ('],
  ['activation-accepts-a-different-version', 'app/(dashboard)/_components/agent-update-gate.tsx',
    "if (!result?.ok || result.activeVersionId !== update.workflow_version_id) {",
    'if (!result?.ok) {'],
];

let killed = 0;
for (const [name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), `implexa-installed-version-ui-${name}-`));
  try {
    for (const copied of files) {
      const target = join(dir, copied);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, copied), target);
    }
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) throw new Error(`${name}: mutation target must occur exactly once`);
    writeFileSync(target, source.replace(from, to));
    const result = spawnSync(process.execPath, ['--test', ...suites.map((suite) => join(dir, suite))], {
      cwd: dir, encoding: 'utf8', env: process.env,
    });
    if (result.status === 0) throw new Error(`SURVIVED: ${name}`);
    killed += 1;
    console.log(`KILLED: ${name}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`All ${killed}/${mutations.length} installed-version Run Now mutations killed`);
