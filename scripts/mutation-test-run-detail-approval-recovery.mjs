#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceBaseline, materializeTree, runSuites } from './mutation-harness-support.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HELPER = 'lib/run-state.ts';
const BUTTON = 'app/(dashboard)/_components/finish-run-button.tsx';
const FILES = [
  HELPER,
  'lib/approval-recovery-request.ts',
  'lib/run-detail-live-transition.test.ts',
  BUTTON,
  'app/(dashboard)/runs/[id]/page.tsx',
  'app/(dashboard)/_components/run-action-items.tsx',
  'app/(dashboard)/_components/run-action-terminal-retry.test.ts',
  'lib/test/render.ts',
  'lib/test/stubs/api.ts',
  'lib/test/stubs/next-link.tsx',
  'lib/test/stubs/next-navigation.ts',
  'lib/test/stubs/supabase.ts',
];
const SUITES = [
  'lib/run-detail-live-transition.test.ts',
  'app/(dashboard)/_components/run-action-terminal-retry.test.ts',
];
const mutations = [
  { name: 'ordinary running run can recover', file: HELPER,
    from: "if (runState !== 'completed'", to: "if (runState !== 'running'" },
  { name: 'review evidence is optional', file: HELPER,
    from: 'if (!hasReviewEvidence || hasFinalOutput', to: 'if (hasFinalOutput' },
  { name: 'existing final output can be rerun', file: HELPER,
    from: 'if (!hasReviewEvidence || hasFinalOutput', to: 'if (!hasReviewEvidence || false' },
  { name: 'approval gate label is not required', file: HELPER,
    from: "|| !/\\b(approval|approve|review|decision|confirm)\\b/i.test(gate.label)", to: '' },
  { name: 'approval click loses server-authoritative recovery mode', file: BUTTON,
    from: "{ kind: 'continue', runId, approvalRecovery: true, source: 'dashboard' }",
    to: "{ kind: 'continue', runId, source: 'dashboard' }" },
  { name: 'existing continuation no longer suppresses recovery', file: 'app/(dashboard)/runs/[id]/page.tsx',
    from: 'approvalContinuationRecovery && !approvalContinuationAlreadyQueued && (',
    to: 'approvalContinuationRecovery && (' },
  { name: 'legacy proposed action replaces authority recovery', file: 'app/(dashboard)/runs/[id]/page.tsx',
    from: '!held && !approvalContinuationRecovery && runActions.length > 0',
    to: '!held && runActions.length > 0' },
  { name: 'legacy proposed action suppresses authority recovery', file: 'app/(dashboard)/runs/[id]/page.tsx',
    from: 'approvalContinuationRecovery && !approvalContinuationAlreadyQueued && (',
    to: 'approvalContinuationRecovery && !approvalContinuationAlreadyQueued && runActions.length === 0 && (' },
  { name: 'recovery suppression uses an unrelated continuation identity', file: 'app/(dashboard)/runs/[id]/page.tsx',
    from: ".eq('id', approvalRecoveryRequestId(r.id))",
    to: ".eq('id', '00000000-0000-4000-8000-000000000099')" },
  { name: 'stale broker settlement is not retryable', file: 'app/(dashboard)/_components/run-action-items.tsx',
    from: "|| (a.linked_request_lifecycle === 'failed'\n        && a.linked_request_failure_reason === 'input_revalidation_unavailable')",
    to: '' },
  { name: 'every failed approval becomes retryable', file: 'app/(dashboard)/_components/run-action-items.tsx',
    from: "&& a.linked_request_failure_reason === 'input_revalidation_unavailable'",
    to: "&& !!a.linked_request_failure_reason" },
  { name: 'linked failure reason is not loaded', file: 'app/(dashboard)/runs/[id]/page.tsx',
    from: ".select('id, status, lifecycle_state, failure_reason')",
    to: ".select('id, status, lifecycle_state')" },
];

announceBaseline({
  label: 'run-detail-approval-recovery', root, files: FILES,
  dir: mkdtempSync(join(tmpdir(), 'implexa-approval-recovery-baseline-')), suites: SUITES,
});
let killed = 0;
for (const mutation of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-approval-recovery-mutant-'));
  try {
    materializeTree(root, FILES, dir);
    const target = join(dir, mutation.file);
    const source = readFileSync(target, 'utf8');
    if (source.split(mutation.from).length !== 2) throw new Error(`stale mutation anchor: ${mutation.name}`);
    writeFileSync(target, source.replace(mutation.from, mutation.to));
    const result = runSuites(root, dir, SUITES);
    if (result.status === 0) throw new Error(`SURVIVED: ${mutation.name}`);
    killed += 1;
    process.stdout.write(`killed: ${mutation.name}\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
process.stdout.write(`run detail approval recovery mutations: ${killed}/${mutations.length} killed\n`);
