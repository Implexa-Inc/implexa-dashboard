#!/usr/bin/env node
// Mutation harness for machine-capability admission on the Dashboard side
// (backend 0346) and the recovery false-positive fix. Each mutant reintroduces
// one way the incident could come back on this surface:
//   • creating the request without asking admission first;
//   • treating the typed 409 as an error sentence instead of the modal;
//   • Recheck continuing the run twice, or deciding readiness in the browser;
//   • dropping the machine name from the request;
//   • the recovery banner returning to a heartbeat count.
// Mutants are materialized into a temp copy (node_modules symlinked); a
// surviving mutant fails the build.

import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// The Run-flow test renders agent-actions.tsx for real, which pulls in most of
// _components and lib — so the WHOLE tree is materialized (node_modules
// symlinked, never copied), not a hand-picked file list that would drift.
function materializeWhole(dir) {
  for (const entry of readdirSync(root)) {
    if (['node_modules', '.next', '.git', '.vercel', 'dist'].includes(entry)) continue;
    cpSync(join(root, entry), join(dir, entry), { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
}
// `node --test <path>` globs `[id]`/`(dashboard)` segments and silently finds
// nothing; the listed runner hands files over verbatim and refuses silence.
function runSuites(_root, dir, suites) {
  const env = { ...process.env, IMPLEXA_MUTANT_ROOT: dir, IMPLEXA_SOURCE_ROOT: root };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [join(dir, 'scripts', 'run-listed-tests.mjs'), ...suites.map((s) => join(dir, s))],
    { cwd: dir, encoding: 'utf8', env, timeout: 240_000, killSignal: 'SIGKILL' });
}
const FLOW = ['app/(dashboard)/_components/setup-required-flow.test.ts'];
const WIRING = ['app/(dashboard)/_components/setup-required-wiring.test.ts'];
const LIB = ['lib/setup-required.test.ts'];
const RECOVERY = ['lib/run-recovery-parity.test.ts', 'app/(dashboard)/runs/[id]/recovered-affordance.test.ts'];
const SURFACES = ['app/(dashboard)/_components/setup-required-surfaces.test.ts'];
const SETUP = ['app/(dashboard)/settings/machine-setup/[slug]/machine-setup-client.test.ts'];
const PROJECTION = ['lib/run-artifact-projection.test.ts'];
const mutations = [
  ['request-created-without-admission', 'app/(dashboard)/_components/agent-actions.tsx',
    "      if (!opts?.admitted) {\n        let admission;",
    "      if (false) {\n        let admission;", [...FLOW, ...WIRING]],
  ['typed-409-rendered-as-error', 'app/(dashboard)/_components/agent-actions.tsx',
    "      const setup = parseSetupRequired(e);\n      if (setup) {\n        setState('idle');", "      const setup = null as ReturnType<typeof parseSetupRequired>;\n      if (setup) {\n        setState('idle');", [...FLOW, ...WIRING]],
  ['recheck-continues-twice', 'app/(dashboard)/_components/setup-required-card.tsx',
    "      if (admittedRef.current) return;\n      if (res?.ok === true && res?.admitted === true) {\n        admittedRef.current = true;", "      if (res?.ok === true && res?.admitted === true) {", [...FLOW, ...WIRING]],
  ['duplicate-recheck-guard-not-synchronous', 'app/(dashboard)/_components/setup-required-card.tsx',
    "    if (inFlightRef.current || admittedRef.current) return;\n    inFlightRef.current = true;", "    if (admittedRef.current) return;", [...FLOW, ...WIRING]],
  ['recheck-asks-about-bridge-machine-not-card', 'app/(dashboard)/_components/setup-required-card.tsx',
    "    const machineId: string | null = current.machine.id;", "    const machineId: string | null = null;", [...FLOW, ...WIRING]],
  ['open-setup-drops-selected-machine', 'lib/setup-required.ts',
    "  const scope = { machineId: card.machine.id, workflowVersionId: version };", "  const scope = { machineId: null, workflowVersionId: version };", [...LIB, ...SURFACES]],
  ['open-setup-guesses-a-slug-when-none-is-known', 'app/(dashboard)/_components/setup-required-card.tsx',
    "    if (!target) {\n      setNote('Implexa could not tell which agent this setup is for. Open the agent’s page and run it from there to see its setup.');\n      return;\n    }\n    if (inApp) { router.push(target.path); return; }",
    "    if (!target) { router.push('/settings/machine-setup/this-agent'); return; }\n    if (inApp) { router.push(target.path); return; }", [...SURFACES, ...WIRING]],
  ['open-setup-ignores-the-agent-the-backend-named', 'lib/setup-required.ts',
    "  const agentSlug = isAgentSlug(slug) ? slug : (card.agent && isAgentSlug(card.agent.slug) ? card.agent.slug : null);", "  const agentSlug = isAgentSlug(slug) ? slug : null;", [...LIB, ...SURFACES]],
  ['open-setup-drops-the-frozen-version', 'lib/setup-required.ts',
    "  const version = isWorkflowVersionId(workflowVersionId) ? workflowVersionId\n    : (card.agent && isWorkflowVersionId(card.agent.workflow_version_id) ? card.agent.workflow_version_id : null);", "  const version = null as string | null;", [...LIB, ...SURFACES]],
  ['continuation-recheck-pre-admits-the-current-version', 'app/(dashboard)/_components/setup-required-card.tsx',
    "      if (!preAdmit || !target) {", "      if (!target) {", [...SURFACES, ...WIRING]],
  ['setup-route-accepts-malformed-scope', 'lib/setup-required.ts',
    "    else return null;\n  }\n  return out;", "  }\n  return out;", LIB],
  ['setup-page-reads-the-current-version-not-the-frozen-one', 'app/(dashboard)/settings/machine-setup/[slug]/machine-setup-client.tsx',
    "${workflowVersionId ? `&workflowVersionId=${encodeURIComponent(workflowVersionId)}` : ''}", "", [...SETUP, ...WIRING]],
  ['run-page-omits-the-frozen-version', 'app/(dashboard)/runs/[id]/page.tsx',
    "<FinishRunButton runId={r.id} slug={r.skill_slug} workflowVersionId={runWorkflowVersionId} />", "<FinishRunButton runId={r.id} />", WIRING],
  ['approve-finish-navigates-on-refusal', 'app/(dashboard)/_components/run-actions.tsx',
    "      if (!gated.ok) { setBusy(null); return; }\n    } catch {\n      setErr('Could not approve. Try again.');",
    "      if (!gated.ok) { setBusy(null); router.push('/workflows'); return; }\n    } catch {\n      setErr('Could not approve. Try again.');", [...SURFACES, ...WIRING]],
  ['gate-swallows-other-errors', 'app/(dashboard)/_components/setup-required-gate.tsx',
    "      if (!card) throw e;", "      if (!card) return { ok: false, setupRequired: true, card: card as unknown as Card };", WIRING],
  ['gate-retries-on-bridge-machine-not-admitted-one', 'app/(dashboard)/_components/setup-required-gate.tsx',
    "await guard(action, onSuccess, admittedMachine ?? card.machine.id);", "await guard(action, onSuccess, null);", [...SURFACES, ...WIRING]],
  ['claude-fallback-on-setup-refusal', 'app/(dashboard)/_components/run-claude-actions.tsx',
    "      if (!gated.ok) return;\n    } catch (error) {", "      if (!gated.ok) { await openInClaude(); return; }\n    } catch (error) {", [...SURFACES, ...WIRING]],
  ['preserved-work-continuation-shows-setup-as-an-error', 'app/(dashboard)/_components/preserved-work-continuation.tsx',
    "      if (!gated.ok) { setBusy(false); return; }", "      if (!gated.ok) { setBusy(false); setError('Setup required before this agent can run.'); router.push('/workflows'); return; }", [...SURFACES, ...WIRING]],
  ['claude-fallback-on-transient-backend-error', 'app/(dashboard)/_components/run-claude-actions.tsx',
    "      setErr(runRequestRefusalCopy(error, 'Could not approve and finish. Nothing was changed. Try again.'));", "      void error; await openInClaude();", [...SURFACES, ...WIRING]],
  ['fix-now-proceeds-behind-refused-enqueue', 'app/(dashboard)/_components/fix-now-button.tsx',
    "    if (!queued) { setFiring(false); return; }", "    if (!queued) { setFiring(false); }", [...SURFACES, ...WIRING]],
  ['stale-ready-shown-after-failed-refresh', 'app/(dashboard)/settings/machine-setup/[slug]/machine-setup-client.tsx',
    "      setStale(true);\n", "", [...SETUP, ...WIRING]],
  ['setup-page-reads-bridge-machine-not-segment', 'app/(dashboard)/settings/machine-setup/[slug]/machine-setup-client.tsx',
    "      if (!selectedMachine.current && native?.executionMachineId) {", "      if (native?.executionMachineId) {", [...SETUP, ...WIRING]],
  ['setup-page-drops-backend-instructions', 'app/(dashboard)/settings/machine-setup/[slug]/machine-setup-client.tsx',
    "                {!ready && Array.isArray(req.setup.instructions) && req.setup.instructions.length ? (", "                {false ? (", [...SETUP, ...WIRING]],
  ['modal-tab-not-contained', 'app/(dashboard)/_components/modal.tsx',
    "      if (e.key !== 'Tab' || !dialog) return;", "      return;", [...FLOW, ...WIRING]],
  ['modal-focus-not-restored', 'app/(dashboard)/_components/modal.tsx',
    "      if (back && typeof back.focus === 'function' && back.isConnected) back.focus();", "", [...FLOW, ...WIRING]],
  ['projection-drops-sha256', 'lib/run-artifact-projection.ts',
    "    sha256: typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256) ? row.sha256 : null,", "    sha256: null,", PROJECTION],
  ['page-hands-display-projection-to-recovery', 'app/(dashboard)/runs/[id]/page.tsx',
    "validatedArtifacts: recoveryArtifacts })", "validatedArtifacts: verifiedArtifacts })", RECOVERY],
  ['recheck-decides-in-browser', 'app/(dashboard)/_components/setup-required-card.tsx',
    "      if (res?.ok === true && res?.admitted === true) {", "      if (res?.ok === true || true) {", [...FLOW, ...WIRING]],
  ['machine-name-dropped-from-request', 'app/(dashboard)/_components/agent-actions.tsx',
    "        ...(executionMachineId ? { executionMachineId } : {}),\n      };", "      };", [...FLOW, ...WIRING]],
  ['probe-recovery-allows-a-mixed-permanent-blocker', 'lib/setup-required.ts',
    "    && blockers.every((item) => item.state === 'probe_failed');", "    && blockers.some((item) => item.state === 'probe_failed');", [...LIB, ...FLOW]],
  ['probe-recovery-allows-an-offline-machine', 'lib/setup-required.ts',
    "    && card.machine.online === true\n", "", LIB],
  ['probe-recovery-allows-a-different-refusal-reason', 'lib/setup-required.ts',
    "  return card.reason === 'required_capability_not_ready'", "  return card.reason !== ''", LIB],
  ['probe-recovery-is-not-used-at-pre-admission', 'app/(dashboard)/_components/agent-actions.tsx',
    "        const eligible = isExactMachineOfflineSetupRefusal(card)\n          || isProbeOnlySetupRefusal(card);",
    "        const eligible = isExactMachineOfflineSetupRefusal(card);", [...FLOW, ...WIRING]],
  ['probe-recovery-ignores-the-backend-recheck-action', 'lib/setup-required.ts',
    "    && card.machine.online === true\n    && isMachineId(card.machine.id)\n    && card.actions.includes('recheck')\n    && blockers.length > 0\n    && blockers.every((item) => item.state === 'probe_failed');",
    "    && card.machine.online === true\n    && isMachineId(card.machine.id)\n    && blockers.length > 0\n    && blockers.every((item) => item.state === 'probe_failed');", LIB],
  ['probe-recovery-loses-the-synchronous-queue-lock', 'app/(dashboard)/_components/agent-actions.tsx',
    "    if (queueInFlightRef.current || state === 'queuing' || state === 'running') return;", "    if (state === 'queuing' || state === 'running') return;", [...FLOW, ...WIRING]],
  ['probe-recovery-accepts-a-foreign-refusal-machine', 'app/(dashboard)/_components/agent-actions.tsx',
    "            || card.machine.id !== executionMachineId) return false;", "            ) return false;", [...FLOW, ...WIRING]],
  ['probe-recovery-continues-after-a-failed-desktop-recheck', 'app/(dashboard)/_components/agent-actions.tsx',
    "        return refreshed.ok === true", "        return true", [...FLOW, ...WIRING]],
  ['probe-recovery-rebuilds-the-request-on-replay', 'app/(dashboard)/_components/agent-actions.tsx',
    "          res = await callBackend('/api/v2/me/run-requests', {\n            jwt: session?.access_token, method: 'POST', body: requestBody,\n          });\n        } catch (secondError)",
    "          res = await callBackend('/api/v2/me/run-requests', {\n            jwt: session?.access_token, method: 'POST', body: { ...requestBody },\n          });\n        } catch (secondError)", [...FLOW, ...WIRING]],
  ['offline-recovery-allows-a-different-reason', 'lib/setup-required.ts',
    "  return card.reason === 'machine_offline'", "  return card.reason !== ''", [...LIB, ...FLOW]],
  ['offline-recovery-allows-an-online-card', 'lib/setup-required.ts',
    "    && card.machine.online === false\n", "", LIB],
  ['offline-recovery-treats-unknown-presence-as-offline', 'lib/setup-required.ts',
    "online: c.machine?.online !== false", "online: c.machine?.online === true", LIB],
  ['offline-recovery-ignores-the-recheck-action', 'lib/setup-required.ts',
    "    && isMachineId(card.machine.id)\n    && card.actions.includes('recheck')\n    && blockers.length > 0\n    && blockers.every((item) => item.state === 'not_checked');",
    "    && isMachineId(card.machine.id)\n    && blockers.length > 0\n    && blockers.every((item) => item.state === 'not_checked');", [...LIB, ...FLOW]],
  ['offline-recovery-allows-a-mixed-card', 'lib/setup-required.ts',
    "    && blockers.every((item) => item.state === 'not_checked');", "    && blockers.some((item) => item.state === 'not_checked');", [...LIB, ...FLOW]],
  ['offline-recovery-loses-the-shared-budget', 'app/(dashboard)/_components/agent-actions.tsx',
    "        automaticRefreshAvailable = false;", "        automaticRefreshAvailable = true;", FLOW],
  ['offline-recovery-trusts-a-foreign-bridge', 'app/(dashboard)/_components/agent-actions.tsx',
    "        if (bridgeMachine !== executionMachineId) return false;", "        if (!bridgeMachine) return false;", FLOW],
  ['offline-recovery-trusts-a-foreign-refresh-result', 'app/(dashboard)/_components/agent-actions.tsx',
    "          && refreshed.machineId === executionMachineId;", "          && true;", FLOW],
  ['offline-recovery-skips-backend-readmission', 'app/(dashboard)/_components/agent-actions.tsx',
    "          if (!(await requireExactBackendReadmission())) throw firstError;",
    "          if (false) throw firstError;", FLOW],
  ['offline-recovery-accepts-re-admission-on-another-machine', 'app/(dashboard)/_components/agent-actions.tsx',
    "          && admission?.machine?.id === executionMachineId;", ";", FLOW],
  ['parse-accepts-any-status', 'lib/setup-required.ts', "  if (e.status !== 409) return null;", "", [...LIB, ...WIRING]],
  ['parse-accepts-any-code', 'lib/setup-required.ts', "  if (c.code !== 'setup_required' || !Array.isArray(c.items)) return null;", "  if (!Array.isArray(c.items)) return null;", [...LIB, ...WIRING]],
  ['optional-items-block', 'lib/setup-required.ts', "  return card.items.filter((item) => item.required && item.state !== 'ready');", "  return card.items.filter((item) => item.state !== 'ready');", LIB],
  ['recovery-heartbeats-recoverable-again', 'lib/run-recovery.ts', "  if (!deliverable) {\n    if (!list.length) return none('no_evidence');", "  if (!deliverable && !list.length) {\n    if (!list.length) return none('no_evidence');", RECOVERY],
  ['recovery-declared-artifact-counts', 'lib/run-recovery.ts', "    && (a.status === undefined || a.status === 'validated')", "    && (a.status === undefined || a.status === 'validated' || a.status === 'declared')", RECOVERY],
  ['recovery-page-ignores-artifacts', 'app/(dashboard)/runs/[id]/page.tsx',
    "deriveRecoveredWork({ runState: r.run_state, outputMarkdown: r.output_markdown, progress, stepsState, validatedArtifacts: recoveryArtifacts })",
    "deriveRecoveredWork({ runState: r.run_state, outputMarkdown: r.output_markdown, progress, stepsState, validatedArtifacts: recoveryArtifacts.length ? recoveryArtifacts : [{ role: 'final_output', status: 'validated', relative_path: 'trace', sha256: 'a'.repeat(64) }] })", RECOVERY],
];

const baselineDir = mkdtempSync(join(tmpdir(), 'implexa-setup-required-baseline-'));
try {
  materializeWhole(baselineDir);
  const baseline = runSuites(root, baselineDir, [...new Set(mutations.flatMap((m) => m[4]))]);
  if (baseline.status !== 0) { console.error(baseline.stdout.slice(-3000), baseline.stderr.slice(-3000)); throw new Error('HARNESS BROKEN: unmutated baseline is red — nothing below could be called a kill'); }
} finally { rmSync(baselineDir, { recursive: true, force: true }); }
console.log('baseline green');
const survivors = [];
for (const [name, file, from, to, suites] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), `implexa-setup-required-${name}-`));
  try {
    materializeWhole(dir);
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) throw new Error(`${name}: mutation target must occur exactly once in ${file}`);
    writeFileSync(target, source.replace(from, to));
    const result = runSuites(root, dir, suites);
    if (result.status === 0) { survivors.push(name); console.log(`SURVIVED: ${name}`); }
    else console.log(`KILLED: ${name}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`${mutations.length - survivors.length}/${mutations.length} setup-required mutations killed${survivors.length ? `; survivors: ${survivors.join(', ')}` : ''}`);
if (survivors.length) process.exit(1);
