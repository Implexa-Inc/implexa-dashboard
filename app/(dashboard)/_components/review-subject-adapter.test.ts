// node --test "app/(dashboard)/_components/review-subject-adapter.test.ts"
//
// The adapter (§3.3, F0 item 5): one entry point, two rooms, two authorities.
//
// The claim under test is not "it renders the right component" — it is that a
// `training_source` subject CANNOT reach the run-review room or its write path. So
// three kinds of evidence, because no one of them is sufficient:
//
//   RENDER    a training subject renders the training authority and no run-review
//             session call is ever made;
//   COMPILER  the training arm cannot be given a run packet, and the run arm cannot be
//             given a training subject; and
//   SOURCE    `<ReviewRoom` is reachable from exactly one case label.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../../../lib/test/render.ts';
import { parseTrainingProjection } from '../../../lib/training-review-projection.ts';
import { TRAINING_CONTRACT_VERSION } from '../../../lib/training-review-actions.ts';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const fixture = JSON.parse(readFileSync(join(ROOT, 'test-fixtures/training-review-f0.v1.json'), 'utf8'));
const ADAPTER = join(ROOT, 'app/(dashboard)/_components/review-subject-room.tsx');
const source = readFileSync(ADAPTER, 'utf8');

test('a training_source subject renders the training authority through the adapter', async () => {
  const calls: string[] = [];
  const rendered = await render('review-subject-room.tsx', {
    kind: 'training_source',
    trainingSessionId: fixture.subject.trainingSessionId,
    sourceId: fixture.subject.sourceId,
    training: {
      agentName: 'Fixture CAM Agent',
      projection: parseTrainingProjection(fixture.projection, TRAINING_CONTRACT_VERSION),
      submissionId: fixture.responses.submitAnnotations.submissionId,
      transport: async (route: string, body: Record<string, unknown>) => {
        calls.push(`${route}:${String(body.action)}`);
        return { status: 200, body: { ok: true, candidateId: '77777777-7777-4777-8777-777777777777' } };
      },
    },
  });
  try {
    const root = rendered.document.querySelector('[data-review-authority]')!;
    assert.equal(root.getAttribute('data-review-authority'), 'training_review');
    assert.equal(root.getAttribute('data-review-subject-kind'), 'training_source');
    // Nothing run-review shaped rendered: no run link, no run-review session call.
    assert.equal(rendered.document.querySelectorAll('a[href^="/runs/"]').length, 0);
    assert.equal(calls.filter((call) => call.includes('/api/review')).length, 0);
    assert.equal(rendered.calls.backend.length, 0);
  } finally { rendered.cleanup(); }
});

test('a confirmed decision writes to the training route and nowhere else', async () => {
  const calls: Array<{ route: string; body: Record<string, unknown> }> = [];
  const rendered = await render('review-subject-room.tsx', {
    kind: 'training_source',
    trainingSessionId: fixture.subject.trainingSessionId,
    sourceId: fixture.subject.sourceId,
    training: {
      agentName: 'Fixture CAM Agent',
      projection: parseTrainingProjection(fixture.projection, TRAINING_CONTRACT_VERSION),
      submissionId: fixture.responses.submitAnnotations.submissionId,
      transport: async (route: string, body: Record<string, unknown>) => {
        calls.push({ route, body });
        return { status: 200, body: { ok: true, candidateId: '77777777-7777-4777-8777-777777777777' } };
      },
    },
  });
  try {
    const good = rendered.document.querySelector('[data-insufficient-evidence="false"]')!;
    await rendered.click([...good.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].route, '/api/training-review');
    assert.equal(calls[0].body.action, 'confirm_training_decision');
    assert.equal(calls[0].body.trainingSessionId, fixture.subject.trainingSessionId);
    assert.ok(!('runId' in calls[0].body), 'a run id must never appear on a training write');
    assert.ok(!/"activate"\s*:\s*true/.test(JSON.stringify(calls[0].body)));
  } finally { rendered.cleanup(); }
});

test('ReviewRoom is reachable from exactly one case label in the adapter', () => {
  // Comments describe the rule; only code can break it.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const uses = code.match(/<ReviewRoom\b/g) ?? [];
  assert.equal(uses.length, 1, 'the run-review room must have exactly one call site here');
  // The LAST switch in the file is the render dispatch (`subjectOf` comes first).
  const runCase = code.lastIndexOf("case 'run_artifact':");
  const trainingCase = code.lastIndexOf("case 'training_source':");
  // `search`, not `indexOf`: a plain substring also matches `Omit<ReviewRoomProps…`
  // in the type section, which is not a render site.
  const reviewRoomAt = code.search(/<ReviewRoom\b/);
  assert.ok(runCase > -1 && trainingCase > -1);
  assert.ok(reviewRoomAt > runCase && reviewRoomAt < trainingCase,
    'ReviewRoom must be rendered inside the run_artifact arm only');
  // The default arm may not fall through to run review.
  assert.match(code, /default:\s*\n?\s*return assertNever\(props, 'ReviewSubjectRoom'\)/);
  // And the render dispatch must not invent a run id for the training arm.
  assert.doesNotMatch(code.slice(trainingCase), /runId/);
});

// ── Compiler evidence ─────────────────────────────────────────────────────────────

/**
 * Compile one probe against the REAL project resolution.
 *
 * A generated tsconfig, not command-line flags: `--paths` is rejected on the CLI
 * (TS6064), and a probe that fails to compile for THAT reason would make every
 * "must not compile" test pass without ever exercising the type it claims to check.
 * `assertProbeReason` below is the second half of that guard.
 */
function tscProbe(body: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'review-adapter-probe-'));
  try {
    const file = join(dir, 'probe.tsx');
    writeFileSync(file, body, 'utf8');
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        noEmit: true, strict: true, skipLibCheck: true, target: 'ES2022',
        lib: ['dom', 'esnext'], jsx: 'react-jsx', module: 'esnext',
        moduleResolution: 'bundler', allowImportingTsExtensions: true,
        esModuleInterop: true, resolveJsonModule: true,
        baseUrl: ROOT, paths: { '@/*': ['./*'] },
      },
      files: [file],
    }), 'utf8');
    try {
      // The compiler binary DIRECTLY and RESOLVED — see `lib/review-subject.test.ts`
      // for why `npx tsc` and a hand-built path both silently fake a refusal.
      execFileSync(process.execPath, [TSC, '--noEmit', '-p', join(dir, 'tsconfig.json')], {
        cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
      });
      return { ok: true, output: '' };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A refusal must be a TYPE refusal — never a resolution or configuration failure. */
function assertProbeRefused(result: { ok: boolean; output: string }, message: string) {
  assert.equal(result.ok, false, message);
  assert.doesNotMatch(result.output, /TS6064|TS2307|Cannot find module/,
    `the probe failed for the wrong reason:\n${result.output}`);
  assert.match(result.output, /TS2(3\d\d|7\d\d)/, `expected a type error, got:\n${result.output}`);
}

const ADAPTER_MODULE = JSON.stringify(ADAPTER);

test('a training_source subject cannot be given a run-review packet', { timeout: 180000 }, () => {
  const probe = `
    import type { ReviewSubjectRoomProps } from ${ADAPTER_MODULE};
    export const props: ReviewSubjectRoomProps = {
      kind: 'training_source',
      trainingSessionId: '11111111-1111-4111-8111-111111111111',
      sourceId: '22222222-2222-4222-8222-222222222222',
      // The naive conflation: a demonstration handed the run room's packet.
      run: {} as never,
      training: {} as never,
    };
  `;
  assertProbeRefused(tscProbe(probe), 'a training arm carrying a run packet must not compile');
});

test('a run_artifact arm cannot omit the run packet or borrow the training one', { timeout: 180000 }, () => {
  const missing = tscProbe(`
    import type { ReviewSubjectRoomProps } from ${ADAPTER_MODULE};
    export const props: ReviewSubjectRoomProps = {
      kind: 'run_artifact',
      runId: '11111111-1111-4111-8111-111111111111',
      artifactId: '22222222-2222-4222-8222-222222222222',
    };
  `);
  assertProbeRefused(missing, 'the run arm must require its own packet');

  const borrowed = tscProbe(`
    import type { ReviewSubjectRoomProps } from ${ADAPTER_MODULE};
    export const props: ReviewSubjectRoomProps = {
      kind: 'run_artifact',
      runId: '11111111-1111-4111-8111-111111111111',
      artifactId: '22222222-2222-4222-8222-222222222222',
      training: {} as never,
    };
  `);
  assertProbeRefused(borrowed, 'the run arm must not accept the training packet');
});

test('subjectOf reconstructs the §3.3 subject for either arm', { timeout: 180000 }, () => {
  const probe = `
    import { subjectOf, type ReviewSubjectRoomProps } from ${ADAPTER_MODULE};
    import type { ReviewSubject } from '@/lib/review-subject';
    export function f(props: ReviewSubjectRoomProps): ReviewSubject { return subjectOf(props); }
  `;
  const result = tscProbe(probe);
  assert.equal(result.ok, true, result.output);
});
