import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const parser='lib/historical-review-candidate.ts', room='app/(dashboard)/_components/review-room.tsx';
const mutants=[
  ['proof-promoted',parser,"c.managerProof !== false","false"],
  ['zero-deferred',parser,"c.deferredCount < 1","c.deferredCount < 0"],
  ['anchors-transferred',parser,"c.issueAnchorTransfer !== 'not_transferred'","false"],
  ['wrong-artifact',parser,"a.id === c.artifactId && ",""],
  ['unvalidated-candidate',parser,"a.status === 'validated'","true"],
  ['old-feedback-carry',room,"? allIssues.filter((issue) => issue.sessionId === session?.id && issue.artifactId === selectedId)","? allIssues"],
  ['wrong-selected-notice',room,"props.historicalCandidates?.find((candidate) => candidate.artifactId === selectedId)","props.historicalCandidates?.[0]"],
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
