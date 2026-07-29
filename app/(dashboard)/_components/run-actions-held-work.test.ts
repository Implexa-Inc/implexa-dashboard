import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const actions = readFileSync(join(root, 'app/(dashboard)/_components/run-actions.tsx'), 'utf8');
const detail = readFileSync(join(root, 'app/(dashboard)/runs/[id]/page.tsx'), 'utf8');
const inbox = readFileSync(join(root, 'app/(dashboard)/inbox/inbox-list.tsx'), 'utf8');
const loader = readFileSync(join(root, 'lib/inbox.ts'), 'utf8');

test('held primary action derives from structured remaining work, not only markdown shipping prose', () => {
  assert.match(actions, /deriveHeldRunPrimaryAction\(/);
  assert.match(actions, /primaryAction === 'continue'[\s\S]*?'Continue the work'/);
  assert.match(actions, /resumesWork \? \(/,
    'a structured continuation must call approveFinish, not markDone');
});

test('both held-run surfaces carry the canonical hold contract into RunActions', () => {
  assert.match(detail, /<RunActions[\s\S]*?stepsState=\{stepsState\}/);
  assert.match(detail, /<RunActions[\s\S]*?holdKind=\{holdKind\}/);
  assert.match(loader, /extraColumns: 'feedback_questions, feedback_answers, feedback_at, steps_state, hold_kind'/);
  assert.match(inbox, /stepsState=\{openItem\.stepsState\}/);
  assert.match(inbox, /holdKind=\{openItem\.holdKind\}/);
});
