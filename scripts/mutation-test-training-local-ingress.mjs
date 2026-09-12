#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const componentPath = 'app/(dashboard)/training/[slug]/training-source.tsx';
const helperPath = 'lib/training-local-ingress.ts';
const testPath = 'app/(dashboard)/training/[slug]/training-source.test.ts';
const originals = new Map([
  [componentPath, readFileSync(resolve(root, componentPath), 'utf8')],
  [helperPath, readFileSync(resolve(root, helperPath), 'utf8')],
]);

const mutations = [
  ['bridge-version', helperPath, "export const TRAINING_LOCAL_CONTRACT_VERSION = '1';", "export const TRAINING_LOCAL_CONTRACT_VERSION = '2';"],
  ['preview-source', helperPath, 'preview.token === sourceToken && preview.timeMs === timeMs', 'true && preview.timeMs === timeMs'],
  ['preview-time', helperPath, 'preview.token === sourceToken && preview.timeMs === timeMs', 'preview.token === sourceToken'],
  ['version-drift', componentPath, 'result.scope.session.baseVersionId !== result.scope.agent.currentVersionId', 'false'],
  ['decision-digest', componentPath, 'result.recordId !== decision.recordId || result.recordDigest !== decision.recordDigest || !result.image', 'result.recordId !== decision.recordId || !result.image'],
  ['accept-confirmation', componentPath, 'disabled={!!busy || !acceptConfirmed} onClick={acceptReviewed}', 'disabled={!!busy} onClick={acceptReviewed}'],
  ['revoke-confirmation', componentPath, 'disabled={!!busy || !revokeConfirmed} onClick={revokeReviewed}', 'disabled={!!busy} onClick={revokeReviewed}'],
  ['source-retryability', componentPath, "{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying registration'", "{true ? <button disabled={!!busy} onClick={() => work('Retrying registration'"],
  ['decision-retryability', componentPath, "{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying saved decision'", "{true ? <button disabled={!!busy} onClick={() => work('Retrying saved decision'"],
  ['single-use-preview', componentPath, 'setDecisionKey(crypto.randomUUID()); setPreview(null); setChosen(\'\');', 'setDecisionKey(crypto.randomUUID()); setChosen(\'\');'],
  ['accept-digest-wire', componentPath, "await call('accept', { token: reviewed.source.token, recordId: reviewed.decision.recordId, expectedDigest: reviewed.decision.recordDigest });", "await call('accept', { token: reviewed.source.token, recordId: reviewed.decision.recordId });"],
  ['accessible-time', componentPath, 'aria-valuetext={formatTrainingTime(time)}', 'aria-label="timestamp"'],
  ['version-negotiation', componentPath, "if (candidate.trainingLocalContractVersion !== TRAINING_LOCAL_CONTRACT_VERSION) {", 'if (false) {'],
];

const stale = mutations.filter(([, file, from]) => originals.get(file).split(from).length !== 2);
if (stale.length) {
  console.error(`Mutation anchors must occur exactly once:\n${stale.map(([name]) => `  ${name}`).join('\n')}`);
  process.exit(1);
}

let killed = 0;
const survivors = [];
try {
  for (const [name, file, from, to] of mutations) {
    const target = resolve(root, file);
    writeFileSync(target, originals.get(file).replace(from, to));
    const result = spawnSync(process.execPath, ['scripts/run-listed-tests.mjs', testPath], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    if (result.status === 0) { survivors.push(name); console.log(`SURVIVED: ${name}`); }
    else { killed += 1; console.log(`KILLED: ${name}`); }
    writeFileSync(target, originals.get(file));
  }
} finally {
  for (const [file, original] of originals) writeFileSync(resolve(root, file), original);
}

console.log(`Training local ingress mutations: ${killed}/${mutations.length} killed`);
if (survivors.length) {
  console.error(`Survivors: ${survivors.join(', ')}`);
  process.exit(1);
}
