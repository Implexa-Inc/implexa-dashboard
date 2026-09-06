import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const parser='lib/historical-review-candidate.ts', room='app/(dashboard)/_components/review-room.tsx';
const notice='app/(dashboard)/_components/historical-review-candidate-notice.tsx';
const mutants=[
  ['proof-promoted',parser,"c.managerProof !== false","false"],
  ['partial-zero-deferred',parser,"Number(record.deferredCount) < 1","Number(record.deferredCount) < 0"],
  ['anchors-transferred',parser,"c.issueAnchorTransfer !== 'not_transferred'","false"],
  ['wrong-artifact',parser,"a.id === c.artifactId && ",""],
  ['unvalidated-candidate',parser,"a.status === 'validated'","true"],
  ['unverified-extra-fields',parser,"!exactKeys(record, UNVERIFIED_KEYS)","false"],
  ['unverified-nonzero-resolution',parser,"record.implementedCount !== 0 || record.deferredCount !== 0","false"],
  ['unverified-zero-unresolved',parser,"Number(record.unresolvedCount) < 1","Number(record.unresolvedCount) < 0"],
  ['unverified-too-many-unresolved',parser,"Number(record.unresolvedCount) > 100","Number(record.unresolvedCount) > 101"],
  ['unverified-scope-dispatch',parser,"} else if (record.scope === 'historical_unverified_candidate') {","} else if (record.scope === 'historical_partial_candidate') {"],
  ['technical-only-resolution-copy',notice,'No correction is reported implemented or deferred.','All corrections are reported implemented.'],
  ['technical-only-proof-copy',notice,'Technical QA does not establish editorial completion, a Judge verdict, or Manager proof.','Technical QA establishes editorial completion, a Judge verdict, and Manager proof.'],
  ['old-feedback-carry',room,"allIssues.filter((issue) => issue.artifactId === selectedId","allIssues.filter((issue) => issue.artifactId === issue.artifactId"],
  ['wrong-selected-notice',room,"props.historicalCandidates?.find((candidate) => candidate.artifactId === selectedId)","props.historicalCandidates?.[0]"],
  ['old-session-fast-path',room,"if (session?.id && session.selectedArtifactId !== artifactId", "if (false && session?.id && session.selectedArtifactId !== artifactId"],
];
const run=cwd=>spawnSync(process.execPath,['--test','lib/historical-review-candidate.test.ts','lib/review-room-click.test.ts'],{cwd,encoding:'utf8',timeout:60000});
let killed=0;
for(const [name,file,from,to] of mutants){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'implexa-historical-ui-mutant-'));
  try{
    for(const folder of ['lib','app','scripts'])fs.cpSync(path.join(root,folder),path.join(dir,folder),{recursive:true});
    for(const file of ['package.json','tsconfig.json'])fs.copyFileSync(path.join(root,file),path.join(dir,file));
    fs.symlinkSync(fs.realpathSync(path.join(root,'node_modules')),path.join(dir,'node_modules'),'dir');
    const baseline=run(dir);
    if(baseline.status!==0)throw new Error(`baseline failed: ${name}\n${baseline.stdout}\n${baseline.stderr}`);
    const target=path.join(dir,file), original=fs.readFileSync(target,'utf8');
    if(original.split(from).length!==2)throw new Error(`seam must occur once: ${name}`);
    fs.writeFileSync(target,original.replace(from,to));
    const result=run(dir), output=result.stdout+result.stderr;
    if(result.status===0){console.error(`SURVIVED ${name}`);process.exitCode=1;}
    else if(!/ERR_ASSERTION|AssertionError/.test(output))throw new Error(`non-assertion failure: ${name}\n${output}`);
    else{console.log(`killed ${name}`);killed++;}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
console.log(`${killed}/${mutants.length} killed`);
