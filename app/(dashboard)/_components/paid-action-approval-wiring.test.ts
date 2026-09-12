import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const page = readFileSync(join(root, 'app/(dashboard)/runs/[id]/page.tsx'), 'utf8');
const inbox = readFileSync(join(root, 'app/(dashboard)/inbox/inbox-list.tsx'), 'utf8');
const review = readFileSync(join(root, 'app/(dashboard)/_components/review-room.tsx'), 'utf8');
const generic = readFileSync(join(root, 'app/(dashboard)/_components/run-actions.tsx'), 'utf8');

test('run detail reads the authenticated backend summary and never renders generic RunActions for a paid hold', () => {
  assert.match(page, /callBackend\(`\/api\/v2\/runs\/\$\{encodeURIComponent\(r\.id\)\}`/);
  assert.match(page, /parsePaidActionApprovalRead\(detail, r\.id\)/);
  assert.match(page, /\{held && effectiveHoldKind === 'approval_before_action' && \(\s*<div[^>]*>\s*<PaidActionApproval/);
  assert.match(page, /\{held && effectiveHoldKind !== 'approval_before_action' && \(\s*<div[^>]*>\s*<RunActions/);
});

test('inbox and Review Room route paid approval to exact run detail instead of generic Continue', () => {
  assert.match(inbox, /openItem\.pending && openItem\.holdKind === 'approval_before_action'[\s\S]*?Review exact paid batch/);
  assert.match(inbox, /openItem\.pending && openItem\.holdKind === 'approval_before_action'[\s\S]*?: openItem\.pending \? \([\s\S]*?<RunActions/);
  assert.match(review, /showApproveNextAction[\s\S]*?href=\{`\/runs\/\$\{runId\}`\}[\s\S]*?Approve next action/);
  assert.match(generic, /holdKind === 'approval_before_action'[\s\S]*?Review exact paid batch/,
    'even a future accidental generic caller must fail closed to exact review');
});
