import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process'; import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'); const file=path.join(root,'app/(dashboard)/_components/agent-learnings-card.tsx');
function run(){return spawnSync(process.execPath,['--test','test/learning-influence.render.test.mjs'],{cwd:root,encoding:'utf8'});}
const baseline=run(); assert.equal(baseline.status,0,`baseline failed\n${baseline.stdout}\n${baseline.stderr}`);
const original=fs.readFileSync(file,'utf8'); const needle="if (source !== 'ready' || !payload) {"; assert.equal(original.split(needle).length-1,1);
try { fs.writeFileSync(file,original.replace(needle,"if (false) { // mutation: fail open")); const result=run(); assert.notEqual(result.status,0,'UI fail-open mutant SURVIVED'); console.log('KILLED: UI fail-open'); }
finally { fs.writeFileSync(file,original); }
console.log('Learning Influence v1 rendered UI mutations: PASS (1/1 killed; baseline green)');
