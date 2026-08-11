#!/usr/bin/env node
/**
 * Mutation tests for the Run Inputs picker binding in the dashboard.
 *
 * Each mutant reintroduces one of the failure modes this code exists to prevent:
 *
 *   • the binding DROPPED — a picker result that produced no bound file and no
 *     message (the 2026-08-05 regression, seen by the user as "the picker closes
 *     and the button still says Choose file");
 *   • POSITIONAL instead of KEYED binding — a file stored by order rather than
 *     under its contract field key;
 *   • FAIL-OPEN required validation — a required field reported as satisfied
 *     when nothing valid is bound to it.
 *
 * A surviving mutant fails the build.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = 'lib/workflow-input-contract.ts';
const COMPONENT = 'app/(dashboard)/_components/agent-actions.tsx';
const UPDATE_COMPONENT = 'app/(dashboard)/_components/agent-update-gate.tsx';
const TESTS = [
  'lib/workflow-input-contract.test.ts',
  'app/(dashboard)/_components/run-input-picker.test.ts',
  'app/(dashboard)/_components/run-input-session-race.test.ts',
  'app/(dashboard)/_components/run-folder-attachments.test.ts',
  'app/(dashboard)/_components/folder-input-render.test.ts',
];
const TEST_MARKERS = [
  'folder snapshots are offered only by an explicit directory snapshot capability',
  'declared folder-capable fields expose a distinct folder snapshot choice',
  'every generic run, continue, and build attachment surface wires the folder handler',
  'Run Now uses the same declared folder capability and replacement identity',
  'Run Now shows folder preparation, blocks duplicate picks and ignores an older saved-source refusal',
];

const mutants = [
  // ── DROPPED BINDING ───────────────────────────────────────────────────────
  // Every refusal read as a cancel: the picker closes, nothing binds, nothing
  // is said. This is exactly what the user reported.
  ['every-failure-treated-as-cancel', LIB,
    "    if (result?.canceled === true || !result?.error) return { kind: 'canceled' };\n    return { kind: 'failed', message: describeInputPickerError(result.error, field) };",
    "    return { kind: 'canceled' };"],
  // A registration that came back incomplete silently produces nothing.
  ['incomplete-registration-silently-dropped', LIB,
    "    return { kind: 'failed', message: describeInputPickerError('incomplete_registration', field) };",
    "    return { kind: 'canceled' };"],
  // The verified digest dropped from the binding — nothing to send at run-create.
  ['binding-drops-the-verified-digest', LIB,
    '      artifactId: result.artifactId,\n      sha256: result.sha256,\n      displayName: result.displayName,',
    '      artifactId: result.artifactId,\n      sha256: undefined as unknown as string,\n      displayName: result.displayName,'],
  // The filename dropped — the field binds but the user sees no confirmation.
  ['binding-drops-the-filename', LIB,
    '      displayName: result.displayName,',
    "      displayName: '',"],
  // A cancel that wipes an already-chosen file.
  ['cancel-clears-the-existing-binding', COMPONENT,
    "      if (outcome.kind === 'canceled') {\n        void verifySavedFileInputs([field], sessionId);\n        return;\n      }",
    "      if (outcome.kind === 'canceled') { setInputDefaults((previous) => { const next = { ...previous }; delete next[field.key]; return next; }); return; }"],
  // A failure that is computed and then thrown away — the original bug's shape.
  ['failure-computed-but-not-shown', COMPONENT,
    "    if (outcome.kind === 'failed') { setInputError(field.key, outcome.message); return; }",
    "    if (outcome.kind === 'failed') { return; }"],
  ['folder-affordance-offered-without-declared-capability', LIB,
    "  return field.kind === 'file' && field.accept?.directorySnapshot === true;",
    "  return field.kind === 'file';"],
  ['folder-capability-inferred-from-zip-again', LIB,
    "  return field.kind === 'file' && field.accept?.directorySnapshot === true;",
    "  return field.kind === 'file' && (field.accept?.extensions ?? []).some((extension) => extension.toLowerCase() === '.zip');"],
  ['directory-response-origin-no-longer-required', LIB,
    "  if (requested === 'directory' && result.origin !== 'directory-snapshot') {",
    "  if (false) {"],
  ['typed-folder-selection-sent-as-a-file', COMPONENT,
    '      selection,',
    "      selection: 'file',"],
  ['run-now-replacement-identity-dropped', COMPONENT,
    '      ...(replaced ? { replacesArtifactId: replaced.artifactId } : {}),',
    '      ...{},'],
  ['activation-replacement-identity-dropped', UPDATE_COMPONENT,
    '      ...(replaced ? { replacesArtifactId: replaced.artifactId } : {}),',
    '      ...{},'],
  ['activation-folder-affordance-removed', UPDATE_COMPONENT,
    "                  {acceptsDirectorySnapshot(field) && <button type=\"button\" onClick={() => void chooseTypedInput(field, 'directory')}",
    "                  {false && <button type=\"button\" onClick={() => void chooseTypedInput(field, 'directory')}"],
  ['generic-folder-attachment-button-removed', 'app/(dashboard)/_components/run-attachments.tsx',
    '          Attach folder',
    '          Attach directory'],
  ['directory-snapshot-failure-is-swallowed', LIB,
    "    case 'directory_snapshot_failed':\n    case 'directory_source_read_short':",
    "    case 'directory_source_read_short':"],
  ['folder-preparation-single-flight-removed', COMPONENT,
    '    if (preparingInputRef.current[field.key]) return;',
    '    if (false) return;'],
  ['manual-replacement-does-not-invalidate-saved-verification-immediately', COMPONENT,
    '    const manualRevision = advanceInputRevision(inputRevisionRef.current, field.key);',
    '    const manualRevision = readInputRevision(inputRevisionRef.current, field.key);'],
  ['folder-preparation-status-removed', COMPONENT,
    "                      {preparing === 'directory' ? 'Preparing ZIP…'",
    "                      {preparing === 'directory' ? 'Choose folder'"],

  // ── POSITIONAL INSTEAD OF KEYED BINDING ───────────────────────────────────
  // Stored under a fixed slot instead of the contract key: whichever file was
  // picked last wins every field.
  ['file-stored-in-a-shared-slot', LIB,
    "  if (field.cardinality !== 'many') return { ...previous, [field.key]: binding };",
    "  if (field.cardinality !== 'many') return { ...previous, file: binding };"],
  // Stored under the artifact id — identity, not role.
  ['file-keyed-by-artifact-instead-of-field', LIB,
    '  return { ...previous, [field.key]: [...list, binding] };',
    '  return { ...previous, [binding.artifactId]: [...list, binding] };'],
  // The wire payload keyed by position rather than by name.
  ['wire-payload-keyed-by-position', LIB,
    '  for (const [key, value] of Object.entries(bindings)) {',
    '  for (const [key, value] of Object.entries(bindings).map(([, v], i) => [String(i), v] as [string, RunInputValue])) {'],
  // Contract order replaced by object insertion order, which is upload order.
  ['field-order-taken-from-insertion-order', LIB,
    '  return contract ? [...contract.fields].sort((a, b) => a.order - b.order) : [];',
    '  return contract ? [...contract.fields] : [];'],

  // ── FAIL-OPEN REQUIRED VALIDATION ─────────────────────────────────────────
  ['required-inputs-never-block', LIB,
    '    if (!field.required) return false;',
    '    return false;'],
  ['empty-string-satisfies-a-required-input', LIB,
    "    return value === undefined || value === null || (typeof value === 'string' && !value.trim())\n      || (Array.isArray(value) && value.length === 0);",
    '    return value === undefined;'],
  ['empty-list-satisfies-a-required-many-input', LIB,
    '      || (Array.isArray(value) && value.length === 0);',
    '      || false;'],
  ['run-button-ignores-required-inputs', COMPONENT,
    'disabled={setupSaving || Object.keys(preparingInputs).length > 0 || blankRequired.length > 0 || missingRequiredInputs(inputContract, inputBindings).length > 0}',
    'disabled={setupSaving || blankRequired.length > 0 || missingRequiredInputs(inputContract, inputBindings).length > 0}'],
  ['submit-guard-ignores-required-inputs', COMPONENT,
    "if (blankRequired.length || missingRequiredInputs(inputContract, inputBindings).length\n        || Object.keys(preparingInputRef.current).length) return;",
    'if (blankRequired.length || missingRequiredInputs(inputContract, inputBindings).length) return;'],
];

function copyForTest(prefix) {
  const dir = mkdtempSync(join(os.tmpdir(), prefix));
  cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => !['node_modules', '.next', '.git', '.vercel', 'dist'].includes(src.split('/').pop() ?? ''),
  });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return dir;
}

function runSuite(dir) {
  return spawnSync(process.execPath, ['scripts/run-selected-tests.mjs', ...TESTS], {
    cwd: dir, encoding: 'utf8', timeout: 90000,
  });
}

{
  const dir = copyForTest('implexa-dash-run-input-baseline-');
  try {
    const baseline = runSuite(dir);
    const output = `${baseline.stdout || ''}\n${baseline.stderr || ''}`;
    const missing = TEST_MARKERS.filter((marker) => !output.includes(marker));
    if (baseline.status !== 0 || missing.length) {
      process.stderr.write('HARNESS BROKEN: unmutated run-input picker suite is not fully green\n');
      if (missing.length) process.stderr.write(`missing test markers: ${missing.join(', ')}\n`);
      process.stderr.write(output);
      process.exit(1);
    }
    process.stdout.write(`BASELINE green — ${TESTS.length} files reported their load-bearing cases\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

let killed = 0;
for (const [name, file, from, to] of mutants) {
  const dir = copyForTest(`implexa-dash-run-input-${name}-`);
  try {
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) {
      throw new Error(`${name}: mutation target must occur exactly once in ${file}`);
    }
    writeFileSync(target, source.replace(from, to));
    const result = runSuite(dir);
    if (result.status === 0) {
      process.stderr.write(`SURVIVED: ${name}\n`);
      process.exitCode = 1;
    } else {
      killed += 1;
      process.stdout.write(`KILLED: ${name}\n`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.exitCode) {
  process.stderr.write(`${killed}/${mutants.length} run-input picker mutants killed\n`);
  process.exit(process.exitCode);
}
process.stdout.write(`All ${killed}/${mutants.length} run-input picker mutants killed\n`);
