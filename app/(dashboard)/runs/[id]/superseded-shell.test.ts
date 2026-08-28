// node --test "app/(dashboard)/runs/[id]/superseded-shell.test.ts"
//
// The run permalink's behaviour when the run belongs to an outcome production.
//
// THE INCIDENT. A two-agent production succeeded and both runs verified
// complete, but following the child link landed on a QUEUED EXECUTION SHELL
// left behind when the node was rerouted to another engine. The page announced
// "This run stalled" and offered "Run again" — inviting a duplicate of work the
// production had already finished and already paid for.
//
// The page is a server component, so these guards are structural: they pin the
// wiring that decides what the page concludes. The behaviour of the pieces
// themselves is graded by render tests (production-lineage-banner) and by the
// backend, which owns the lineage verdict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fixture from '../../../../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };
import { parseLineageResponse } from '../../../../lib/outcome-production-detail.ts';
import { supersedesFailureNarrative } from '../../_components/production-lineage-narrative.ts';

const PAGE = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');
const RAW = fixture as unknown as Record<string, any>;

const superseded = parseLineageResponse(RAW.responses.lineageSupersededShell)!;
const authoritative = parseLineageResponse(RAW.responses.lineageAuthoritative)!;

test('the page asks the backend for lineage and renders the parent link', () => {
  assert.match(PAGE, /loadProductionLineage\(r\.id, session\.access_token\)/,
    'lineage is read for the run being displayed');
  assert.match(PAGE, /<ProductionLineageBanner lineage=\{productionLineage\}/,
    'a run inside a production always points at its parent');
});

test('a superseded shell demotes the page\'s own "this run stalled" conclusion', () => {
  assert.equal(supersedesFailureNarrative(superseded), true);
  assert.equal(supersedesFailureNarrative(authoritative), false);
  assert.equal(supersedesFailureNarrative(null), false);

  // The failure block's headline is conditional on it, and the superseded copy
  // is explicitly NOT a claim about the work.
  assert.match(PAGE, /supersededByRelated\s*$|supersededByRelated/m);
  assert.match(PAGE, /What this superseded attempt recorded before it was replaced/,
    'the stall becomes a footnote about an abandoned attempt');
  assert.match(PAGE, /\{supersededByRelated\s*\n?\s*\?\s*'What this superseded attempt/,
    'the headline itself is what changes, not just the styling');
});

test('"Run again" is withheld once the parent settled the node as a success', () => {
  assert.equal(superseded.suppressRunAgain, true);
  assert.match(PAGE, /\{!productionLineage\?\.suppressRunAgain && !suppressDuplicateRetry\(recoveryPresentation\) && \(\s*\n\s*<Link href=\{agentHref\}/,
    'the only "Run again" control is gated on lineage and on authoritative recovery evidence');
  // And restarting a superseded attempt would race the run actually carrying
  // the node, so the stuck-run control is withheld too.
  assert.match(PAGE, /\{!supersededByRelated && !suppressDuplicateRetry\(recoveryPresentation\) && \(\s*\n\s*<StuckRunButton/);
});

test('redirecting to the authoritative run is preferred, but only when nothing is lost', () => {
  assert.match(PAGE, /function safeToRedirectToAuthority\(/);
  // A shell that wrote something of its own is NOT redirected away from.
  assert.match(PAGE, /if \(ownOutput && ownOutput\.trim\(\)\) return null;/);
  // Nor is one whose "authority" has not actually completed.
  assert.match(PAGE, /authoritativeRunState !== 'completed'/);
  // The redirect discloses where it came from rather than moving silently…
  assert.match(PAGE, /redirect\(`\/runs\/\$\{authority\}\?superseded=\$\{encodeURIComponent\(r\.id\)\}`\)/);
  assert.match(PAGE, /You followed a link to an earlier execution attempt that was superseded/);
  // …and a reader who deliberately returns to the shell is not bounced again.
  assert.match(PAGE, /searchParams\?\.keep === '1'/);
  assert.match(PAGE, /\?keep=1/);
  // A run is never redirected to itself: the failure mode here is not a wrong
  // label, it is an infinite redirect that takes the page down.
  assert.match(PAGE, /if \(lineage\.authoritativeRunId === viewedRunId\) return null;/);
  assert.match(PAGE, /safeToRedirectToAuthority\(productionLineage, r\.output_markdown, r\.id\)/);
});

test('the production lineage supersedes the generic same-agent sibling hint', () => {
  // The old sibling box guesses at a related run from the agent slug. Inside a
  // production the parent NAMES the authoritative run, so showing both would
  // offer two different "related run" answers on one page.
  assert.match(PAGE, /\{siblingRun && !productionLineage && \(/);
});

test('the fixture\'s superseded shell is exactly the reference incident', () => {
  assert.equal(superseded.superseded, true);
  assert.equal(superseded.isAuthoritative, false);
  assert.equal(superseded.nodeOutcomeLabel, 'succeeded', 'the NODE succeeded — only this attempt did not');
  assert.equal(superseded.authoritativeRunState, 'completed');
  assert.notEqual(superseded.viewedRunId, superseded.authoritativeRunId);
});
