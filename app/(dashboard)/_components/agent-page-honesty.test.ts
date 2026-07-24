// node --test "app/(dashboard)/_components/agent-page-honesty.test.ts"
//
// Two founder-reported agent-page defects (2026-07-24):
//   1. Edit + Update showed STALE steps until a manual reload — a revise lands
//      asynchronously and nothing watched for the landing.
//   2. "Ready to run — everything it needs is set up" sat next to a "Finish
//      setup" button.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const poller = readFileSync(join(dir, 'revise-landed-poller.tsx'), 'utf8');
const readiness = readFileSync(join(dir, 'agent-readiness.tsx'), 'utf8');
const page = readFileSync(join(dir, '..', 'workflows', '[slug]', 'page.tsx'), 'utf8');
const improve = readFileSync(join(dir, 'improve-agent.tsx'), 'utf8');

// ── 1. the stale-agent-after-edit bug ────────────────────────────────────────

test('the page WATCHES for the rewrite to land — enqueue-time refresh alone is the bug', () => {
  // ImproveAgent's router.refresh() fires at ENQUEUE, which is why the banner
  // appeared instantly and the steps never updated. Something must watch after.
  assert.match(improve, /router\.refresh\(\)/, 'the enqueue-time refresh still exists (it shows the banner)');
  assert.match(page, /<ReviseLandedPoller revisePending=\{revisePending\}/,
    'and the page must also watch for the LANDING, or the steps stay stale until a manual reload');
});

test('the poller re-runs the SERVER render — that is what re-derives revisePending', () => {
  assert.match(poller, /router\.refresh\(\)/,
    'revisePending is computed server-side, so refreshing the server component IS the check');
  assert.match(poller, /if \(!revisePending\)/, 'and it does nothing when no rewrite is in flight');
});

test('the poll is BOUNDED and self-terminating — a never-landing revise must not spin forever', () => {
  assert.match(poller, /const DELAYS_MS = \[/, 'a finite backoff schedule, not a fixed interval');
  assert.match(poller, /attempt\.current > DELAYS_MS\.length.*setGaveUp\(true\)/s,
    'it gives up at the end of the budget');
  // Giving up SILENTLY would leave a page that looks like it is still watching.
  assert.match(poller, /Still waiting on your Claude/,
    'and says so plainly rather than quietly looking busy');
});

test('a SECOND edit gets a fresh budget (the give-up state must reset)', () => {
  assert.match(poller, /if \(!revisePending\) \{ attempt\.current = 0; setGaveUp\(false\); return; \}/,
    'otherwise one exhausted rewrite would permanently disable watching for every later edit');
});

// ── 2. the contradictory CTA ─────────────────────────────────────────────────

// Comments explain the rule and necessarily QUOTE the old label, so this reads
// CODE only — the prose defending a rule must not be what fails it.
const codeOnly = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('a READY agent is never told to "Finish setup"', () => {
  assert.doesNotMatch(codeOnly(readiness), /Finish setup/,
    'the ready branch only renders for an ACTIVE, unblocked, key-satisfied agent — '
    + 'there is nothing left to finish, and saying so contradicts the headline right beside it');
});

test('ready still keeps a way INTO the provisioning detail, worded honestly', () => {
  assert.match(readiness, /Review setup/, 'a review, not unfinished work');
  assert.match(readiness, /Everything it needs is set up/, 'the headline is unchanged — it was correct');
});
