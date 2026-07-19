import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'app', '(dashboard)', '_components');
const policy = readFileSync(join(dir, 'implexa-judge-policy.tsx'), 'utf8');
const card = readFileSync(join(dir, 'run-judgment-card.tsx'), 'utf8');
const activation = readFileSync(join(dir, 'activation-card.tsx'), 'utf8');
const workflow = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'workflows', '[slug]', 'page.tsx'), 'utf8');

test('Judge is opt-in at Activate and remains editable in Setup', () => {
  assert.match(activation, /<ImplexaJudgePolicy slug=\{checklist\.slug\} compact/);
  assert.match(workflow, /<ImplexaJudgePolicy slug=\{workflow\.slug\}/);
  assert.match(policy, /mode: next/);
  assert.match(policy, /'every_run'/);
});

test('Judge copy discloses cross-engine preference, fresh fallback, and subscription use', () => {
  assert.match(policy, /Claude reviews Codex, or Codex reviews Claude/);
  assert.match(policy, /new session on the same engine/);
  assert.match(policy, /uses your own subscription/);
});

test('AI judgment is visibly separate from evidence-based verification', () => {
  assert.match(card, /AI review/);
  assert.match(card, /separate from evidence-based “Verified complete.”/);
});
