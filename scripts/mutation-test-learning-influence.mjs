import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process'; import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'); const file=path.join(root,'app/(dashboard)/_components/agent-learnings-card.tsx');
function run(){return spawnSync(process.execPath,['--test','test/learning-influence.render.test.mjs','app/(dashboard)/_components/agent-learnings-card.test.ts'],{cwd:root,encoding:'utf8'});}
const baseline=run(); assert.equal(baseline.status,0,`baseline failed\n${baseline.stdout}\n${baseline.stderr}`);
const original=fs.readFileSync(file,'utf8');
const mutants = [
  ['UI fail-open', "if (source !== 'ready' || !payload) {", "if (false) { // mutation: fail open"],
  ['historical analysis disabled', 'disabled={busy !== null} onClick={() => void analyzePastFeedback()}',
    'disabled={true} onClick={() => void analyzePastFeedback()}'],
  ['historical action detached', 'onClick={() => void analyzePastFeedback()}',
    'onClick={() => undefined}'],
  ['historical endpoint unbound', '/learning-influence/backfill`', '/learning-influence`'],
  ['low-evidence warning removed', 'Only 1 independent run supports this suggestion.', 'This suggestion is unavailable.'],
  ['low-evidence override disabled', 'item.eligible || canApproveLowEvidence(item)', 'item.eligible'],
  ['low-evidence override detached', 'allowLowEvidence: canApproveLowEvidence(item)', 'allowLowEvidence: false'],
  ['rule refinement action detached', 'onClick={() => beginEdit(item)}', 'onClick={() => undefined}'],
  ['rule refinement endpoint unbound', '/learning-influence/candidates/${item.id}/refine`', '/learning-influence/candidates/${item.id}/dismiss`'],
];
try {
  for (const [name, needle, replacement] of mutants) {
    assert.equal(original.split(needle).length-1,1,`${name}: anchor must occur once`);
    fs.writeFileSync(file,original.replace(needle,replacement));
    const result=run(); assert.notEqual(result.status,0,`${name} mutant SURVIVED`); console.log(`KILLED: ${name}`);
  }
}
finally { fs.writeFileSync(file,original); }
console.log(`Learning Influence v1 rendered UI mutations: PASS (${mutants.length}/${mutants.length} killed; baseline green)`);
