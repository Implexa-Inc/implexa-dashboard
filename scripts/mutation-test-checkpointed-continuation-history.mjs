#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const page = 'app/(dashboard)/runs/[id]/page.tsx';
const component = 'app/(dashboard)/_components/checkpointed-continuation-history.tsx';
const suite = 'lib/checkpointed-continuation-history-ui.test.ts';
const mutations = [
  ['unavailable becomes empty', component, 'Continuation history could not be checked', ''],
  ['continuation is mislabeled Needs You', component, 'do not need your input', 'Needs You'],
  ['attempt state is overstated as verified reuse', component, 'Continuation process started', 'Verified and reused'],
  ['ended process state is hidden', component, 'Continuation process ended', 'Continuation process started'],
  ['pre-start exit is mislabeled reuse refusal', component, 'Continuation ended before process start', 'Reuse refused'],
  ['pending materialization is overstated', component, 'Preserved-file verification pending', 'Preserved files verified'],
  ['checkpoint identity is hidden', component, 'checkpoint {short(item.checkpointId)}', 'checkpoint hidden'],
  ['materialization receipt identity is hidden', component,
    'materialization {short(item.materializationDigest)}', 'materialization hidden'],
  ['run page omits history', page, '        <CheckpointedContinuationHistoryCard history={checkpointedContinuations} />', ''],
];
let killed = 0;
for (const [name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-continuation-history-'));
  try {
    for (const copied of [page, component, suite]) {
      const target = join(dir, copied); mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, copied), target);
    }
    const target = join(dir, file); const source = readFileSync(target, 'utf8');
    if (source.split(from).length - 1 !== 1) throw new Error(`${name}: unique seam required`);
    writeFileSync(target, source.replace(from, to));
    const result = spawnSync(process.execPath, ['--test', join(dir, suite)], { cwd: dir, encoding: 'utf8' });
    if (result.status === 0) throw new Error(`SURVIVED: ${name}`);
    console.log(`KILLED: ${name}`); killed += 1;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`${killed}/${mutations.length} continuation-history mutants killed`);
