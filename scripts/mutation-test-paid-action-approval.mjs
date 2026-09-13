#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceBaseline, materializeTree, runSuites } from './mutation-harness-support.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONTRACT = 'lib/paid-action-approval.ts';
const COMPONENT = 'app/(dashboard)/_components/paid-action-approval.tsx';
const PAGE = 'app/(dashboard)/runs/[id]/page.tsx';
const INBOX = 'app/(dashboard)/inbox/inbox-list.tsx';
const FILES = [
  'tsconfig.json',
  CONTRACT, 'lib/paid-action-approval.test.ts', COMPONENT,
  'app/(dashboard)/_components/paid-action-approval.test.ts',
  'app/(dashboard)/_components/paid-action-approval-wiring.test.ts',
  PAGE, INBOX, 'app/(dashboard)/_components/run-actions.tsx',
  'app/(dashboard)/_components/review-room.tsx',
  'lib/test/render.ts', 'lib/test/stubs/api.ts', 'lib/test/stubs/next-navigation.ts',
  'lib/test/stubs/next-link.tsx', 'lib/test/stubs/supabase.ts',
];
const SUITES = [
  'lib/paid-action-approval.test.ts',
  'app/(dashboard)/_components/paid-action-approval.test.ts',
  'app/(dashboard)/_components/paid-action-approval-wiring.test.ts',
];
const mutations = [
  { name: 'v2 summary becomes approvable', file: CONTRACT, from: "value.contractVersion !== 'paid-action-approval-summary.v3'", to: "value.contractVersion !== 'paid-action-approval-summary.v2'" },
  { name: 'manifest digest accepts uppercase', file: CONTRACT, from: "const SHA256_RE = /^[a-f0-9]{64}$/;", to: "const SHA256_RE = /^[A-Fa-f0-9]{64}$/;" },
  { name: 'checkpoint identity need not be valid', file: CONTRACT, from: "|| typeof value.projectCheckpointId !== 'string' || !UUID_RE.test(value.projectCheckpointId)", to: "|| typeof value.projectCheckpointId !== 'string'" },
  { name: 'checkpoint digest need not be valid', file: CONTRACT, from: "|| typeof value.projectCheckpointDigest !== 'string' || !SHA256_RE.test(value.projectCheckpointDigest)", to: "|| typeof value.projectCheckpointDigest !== 'string'" },
  { name: 'unbounded trusted input set accepted', file: CONTRACT, from: 'value.inputs.length > 16', to: 'value.inputs.length > 100' },
  { name: 'input path accepted as display name', file: CONTRACT, from: '|| /[\\\\/\\r\\n]/.test(input.displayName)', to: '' },
  { name: 'duplicate input semantics accepted', file: CONTRACT, from: '|| typeof input.semanticKey !== \'string\' || !ACTION_RE.test(input.semanticKey) || semanticKeys.has(input.semanticKey)', to: "|| typeof input.semanticKey !== 'string' || !ACTION_RE.test(input.semanticKey)" },
  { name: 'presenter input need not be disclosed', file: CONTRACT, from: "if (!semanticKeys.has('project_bundle') || !semanticKeys.has('presenter_video')) return null;", to: "if (!semanticKeys.has('project_bundle')) return null;" },
  { name: 'duplicate provider request accepted', file: CONTRACT, from: '|| requestIds.has(request.requestId)', to: '' },
  { name: 'other provider becomes approvable', file: CONTRACT, from: "value.provider !== 'higgsfield'", to: "typeof value.provider !== 'string'" },
  { name: 'other provider operation becomes approvable', file: CONTRACT, from: "value.operation !== 'kling3_0.video_generation'", to: "typeof value.operation !== 'string'" },
  { name: 'unsafe request identity becomes approvable', file: CONTRACT, from: '!REQUEST_REF_RE.test(request.requestId)', to: 'request.requestId.length < 1' },
  { name: 'unsafe scene identity becomes approvable', file: CONTRACT, from: '!REQUEST_REF_RE.test(request.sceneId)', to: 'request.sceneId.length < 1' },
  { name: 'unsupported model becomes approvable', file: CONTRACT, from: "request.model !== 'kling3_0'", to: "typeof request.model !== 'string'" },
  { name: 'request placement may be empty', file: CONTRACT, from: "|| typeof request.intendedUse !== 'string' || request.intendedUse.length < 1 || request.intendedUse.length > 500", to: "|| typeof request.intendedUse !== 'string' || request.intendedUse.length > 500" },
  { name: 'unsafe output destination becomes approvable', file: CONTRACT, from: "|| typeof request.outputRelativePath !== 'string' || !OUTPUT_RELATIVE_PATH_RE.test(request.outputRelativePath)", to: "|| typeof request.outputRelativePath !== 'string'" },
  { name: 'duplicate output destination becomes approvable', file: CONTRACT, from: '|| outputRelativePaths.has(request.outputRelativePath)', to: '' },
  { name: 'aspect-only resolution becomes approvable', file: CONTRACT, from: "const EXECUTABLE_RESOLUTIONS = new Set(['1920x1080', '1080p', '1080x1920', '1080x1080']);", to: "const EXECUTABLE_RESOLUTIONS = new Set(['1920x1080', '1080p', '1080x1920', '1080x1080', '16:9']);" },
  { name: 'fractional duration becomes approvable', file: CONTRACT, from: '|| !Number.isSafeInteger(request.durationSeconds)', to: '' },
  { name: 'over-precise item cost becomes approvable', file: CONTRACT, from: '|| Number(request.estimatedCost.toFixed(6)) !== request.estimatedCost', to: '' },
  { name: 'backward source range accepted', file: CONTRACT, from: '|| (request.sourceRange.endFrame as number) <= (request.sourceRange.startFrame as number)', to: '|| (request.sourceRange.endFrame as number) === (request.sourceRange.startFrame as number)' },
  { name: 'batch count need not match requests', file: CONTRACT, from: '|| !Array.isArray(value.requests) || value.requests.length !== value.requestCount', to: '|| !Array.isArray(value.requests)' },
  { name: 'cost total need not match items', file: CONTRACT, from: 'if (Number(estimatedTotal.toFixed(6)) !== Number(value.estimatedCost.toFixed(6))) return null;', to: '' },
  { name: 'summary can bind another run', file: CONTRACT, from: "if (run.id !== expectedRunId) return { state: 'unavailable', reason: 'malformed' };", to: '' },
  { name: 'v2 unavailable reason is treated as ready migration', file: CONTRACT, from: "approval.reason === 'paid_action_manifest_v3_required'", to: "approval.reason === 'paid_action_manifest_v2_required'" },
  { name: 'approval response may add authority', file: CONTRACT, from: "if (!exactKeys(value, ['ok', 'requestId', 'approvalDigest', 'summary', 'idempotent'])", to: "if (!value || typeof value !== 'object'" },
  { name: 'approval response may change reviewed batch', file: CONTRACT, from: 'return summary !== null && canonical(summary) === canonical(expected);', to: 'return summary !== null;' },
  { name: 'approval posts generic continuation', file: COMPONENT, from: '}/paid-action-approval`', to: '}/review`' },
  { name: 'approval drops manifest digest identity', file: COMPONENT, from: 'requestManifestDigest: summary.requestManifestDigest,', to: "requestManifestDigest: '0'.repeat(64)," },
  { name: 'approval drops checkpoint identity', file: COMPONENT, from: 'projectCheckpointId: summary.projectCheckpointId,', to: "projectCheckpointId: '10000000-0000-4000-8000-000000000099'," },
  { name: 'approval drops checkpoint digest', file: COMPONENT, from: 'projectCheckpointDigest: summary.projectCheckpointDigest,', to: "projectCheckpointDigest: '0'.repeat(64)," },
  { name: 'double click bypasses single-flight guard', file: COMPONENT, from: 'if (inFlight.current) return;', to: 'if (false) return;' },
  { name: 'sub-cent dollars are hidden', file: CONTRACT, from: 'minimumFractionDigits: 2, maximumFractionDigits: 6,', to: 'minimumFractionDigits: 2, maximumFractionDigits: 2,' },
  { name: 'unknown pending hold becomes generic', file: CONTRACT, from: "if (pending && holdKind === null) return 'unavailable';", to: "if (pending && holdKind === null) return 'generic';" },
  { name: 'paid hold renders generic run actions', file: PAGE, from: "{heldApprovalSurface === 'generic' && (", to: '{true && (' },
  { name: 'paid hold does not render exact approval', file: PAGE, from: "{heldApprovalSurface === 'paid_action' && (", to: '{false && (' },
  { name: 'unreadable hold exposes no unavailable state', file: PAGE, from: "{heldApprovalSurface === 'unavailable' && (", to: '{false && (' },
  { name: 'inbox paid hold opens generic action', file: INBOX, from: "}) === 'paid_action' ? (", to: "}) === 'never_paid' ? (" },
];

announceBaseline({ label: 'paid-action-approval', root, files: FILES,
  dir: mkdtempSync(join(tmpdir(), 'implexa-paid-approval-baseline-')), suites: SUITES });
let killed = 0;
for (const mutation of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-paid-approval-mutant-'));
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
process.stdout.write(`paid action approval mutations: ${killed}/${mutations.length} killed\n`);
