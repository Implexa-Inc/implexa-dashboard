import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'lib/review-audio-evidence.ts'), 'utf8');
const mutations = [
  ['coordinate dedup identity', '[r.space, r.file, r.reviewedOriginMs]', '[r.file, r.reviewedOriginMs]'],
  ['positive audition interval', 'r.endMs <= r.startMs', 'r.endMs < r.startMs'],
  ['explicit clip origin conversion', 'time(r.reviewedOriginMs + r.startMs)', 'time(r.startMs)'],
  ['transcript listening limitation', 'audio has not been checked by listening', 'audio was verified by listening'],
];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'review-audio-mutations-'));
try {
  fs.copyFileSync(path.join(root, 'lib/review-audio-evidence.test.ts'), path.join(work, 'review-audio-evidence.test.ts'));
  const run = value => {
    fs.writeFileSync(path.join(work, 'review-audio-evidence.ts'), value);
    return spawnSync(process.execPath, ['--test', path.join(work, 'review-audio-evidence.test.ts')], { encoding: 'utf8', timeout: 30000 });
  };
  const baseline = run(source);
  if (baseline.status !== 0) throw new Error(`baseline failed: ${baseline.stdout}\n${baseline.stderr}`);
  for (const [name, from, to] of mutations) {
    if (source.split(from).length !== 2) throw new Error(`target not unique: ${name}`);
    const result = run(source.replace(from, to));
    if (result.status === 0 || !/AssertionError/.test(result.stdout + result.stderr)
        || /ERR_MODULE_NOT_FOUND|SyntaxError/.test(result.stdout + result.stderr)) throw new Error(`invalid/surviving mutant: ${name}\n${result.stdout}\n${result.stderr}`);
    console.log(`Killed by behavioral assertion: ${name}`);
  }
  console.log(`${mutations.length}/${mutations.length} mutations killed; baseline passed.`);
} finally { fs.rmSync(work, { recursive: true, force: true }); }
