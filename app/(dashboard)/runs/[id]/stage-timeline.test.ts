'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = process.cwd();
const page = readFileSync(join(root, 'app/(dashboard)/runs/[id]/page.tsx'), 'utf8');

test('run detail reads staged plan from the backend API, not a prompt-only checklist', () => {
  assert.match(page, /callBackend\(`\/api\/v2\/runs\/\$\{encodeURIComponent\(params\.id\)\}`/,
    'the stage timeline should use the backend run API that owns unavailable-vs-empty semantics');
  assert.match(page, /detail\?\.run\?\.stagePlan\?\.stages/,
    'the rendered timeline must come from the durable stagePlan payload');
});

test('stage timeline unavailable renders as an explicit warning, not an empty timeline', () => {
  assert.match(page, /stageTimelineUnavailable = true/,
    'a failed stage read must set an unavailable state');
  assert.match(page, /The staged plan is temporarily unavailable/,
    'the user should see unavailable, not no stages');
});

test('stage timeline is read-only', () => {
  assert.match(page, /function StageTimeline/,
    'the run page should include the timeline component');
  assert.doesNotMatch(page, /transitionStage|approveStage|retryStage/,
    'Slice 1 dashboard must not mutate stages');
});

