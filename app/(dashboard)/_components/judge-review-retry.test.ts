import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui=readFileSync('app/(dashboard)/_components/judge-review-retry.tsx','utf8');
const card=readFileSync('app/(dashboard)/_components/run-judgment-card.tsx','utf8');
const page=readFileSync('app/(dashboard)/runs/[id]/page.tsx','utf8');
test('uncertain review uses the owner retry endpoint and pins the viewed judgment and validated final video',()=>{
 assert.match(ui,/\/judge-retry/);assert.match(ui,/priorJudgmentId: judgmentId, expectedFinalOutputSha256: finalOutputSha256/);
 assert.match(card,/judgment.verdict === 'uncertain' && judgment.id && currentRunId && finalOutputSha256/);
 assert.match(page,/finalOutputSha256=\{recoveryArtifacts\.find/);
 assert.match(page,/artifact.relative_path === recoveredFinalArtifact\?\.relativePath/);
 assert.doesNotMatch(ui,/continuePrompt|\/run-requests|\/resolve/);
});
test('queued retries stay visible and use existing bounded Judge polling despite the previous verdict',()=>{
 assert.match(ui,/disabled=\{busy \|\| pending \|\| queued\}/);
 assert.match(ui,/The agent will not run again/);
 assert.match(page,/if \(\(!judgment \|\| judgment.verdict === 'uncertain'\) && !judgmentReadUnavailable\)/);
 assert.match(page,/reviewPending=\{judgmentPending\}/);
 assert.match(page,/judgmentPending && <RunJudgmentPending/);
});
