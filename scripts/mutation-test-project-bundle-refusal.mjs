import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = new URL('../app/(dashboard)/_components/agent-actions.tsx', import.meta.url);
const source = fs.readFileSync(file, 'utf8');
const mutants = [
  ['typed refusal dispatch', 'if (bundle) {', 'if (false) {'],
  ['same-tick single flight', 'if (bundleRecheckRef.current || queueInFlightRef.current) return;', 'if (false) return;'],
  ['fresh reinspection binding', 'opts?.inputBindingsOverride ?? inputBindings', 'inputBindings'],
  ['selection preservation', "setState('idle'); setMsg(''); setBundleRefusal(bundle);", "setState('idle'); setMsg(''); setBundleRefusal(bundle); setInputOverrides({});"],
];
const run = () => spawnSync(process.execPath, ['--test', '--test-timeout=10000', 'app/(dashboard)/_components/project-bundle-refusal.test.ts'], { encoding: 'utf8', timeout: 20000 });
try {
  if (run().status !== 0) throw new Error('baseline failed');
  for (const [name, before, after] of mutants) {
    if (!source.includes(before)) throw new Error(`missing mutation: ${name}`);
    fs.writeFileSync(file, source.replace(before, after));
    const result = run();
    if (result.status === 0 || result.error) throw new Error(`survived or timed out: ${name}`);
    console.log(`killed: ${name}`);
  }
  console.log('4/4 mutations killed');
} finally { fs.writeFileSync(file, source); }
