#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const page = 'app/(dashboard)/runs/[id]/page.tsx';
const component = 'app/(dashboard)/_components/verified-artifacts.tsx';
const suite = 'app/(dashboard)/runs/[id]/verified-artifacts.test.ts';
const files = [page, component];

const mutations = [
  ['empty-artifact-list-hides-the-entire-surface', component,
    '  const router = useRouter();',
    '  if (!artifacts.length) return null;\n  const router = useRouter();'],
  ['late-validation-cannot-be-refreshed', component,
    'onClick={() => refresh(() => router.refresh())}',
    'onClick={() => refresh(() => undefined)}'],
  ['large-artifact-list-is-unbounded', component,
    'max-h-[28rem] overflow-y-auto ',
    ''],
  ['unvalidated-worker-claim-becomes-openable', page,
    ".eq('status', 'validated')",
    ".neq('status', 'rejected')"],
  ['files-return-below-final-output', page,
    '        <VerifiedArtifacts artifacts={verifiedArtifacts} />\n\n        {/* First quality-mode entry point',
    '        {/* First quality-mode entry point'],
];

let killed = 0;
for (const [name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), `implexa-run-artifacts-${name}-`));
  try {
    for (const copied of files) {
      const target = join(dir, copied);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, copied), target);
    }
    // node:test treats route brackets in positional paths as glob syntax. Copy
    // the suite to a flat path so a green result can never mean "zero tests".
    const flatSuite = join(dir, 'verified-artifacts.test.ts');
    cpSync(join(root, suite), flatSuite);
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) {
      throw new Error(`${name}: mutation target must occur exactly once`);
    }
    let mutated = source.replace(from, to);
    if (name === 'files-return-below-final-output') {
      const marker = '              <RunMarkdown markdown={r.output_markdown} workspaceRoot={workspaceRoot} />';
      if (!mutated.includes(marker)) throw new Error(`${name}: output marker missing`);
      mutated = mutated.replace(marker, `${marker}\n            <VerifiedArtifacts artifacts={verifiedArtifacts} />`);
    }
    writeFileSync(target, mutated);
    const result = spawnSync(process.execPath, ['--test', flatSuite], {
      cwd: dir,
      encoding: 'utf8',
      env: process.env,
    });
    if (result.status === 0) throw new Error(`SURVIVED: ${name}`);
    killed += 1;
    console.log(`KILLED: ${name}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`All ${killed}/${mutations.length} run-artifact visibility mutations killed`);
