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

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = 'lib/workflow-input-contract.ts';
const COMPONENT = 'app/(dashboard)/_components/agent-actions.tsx';
const TESTS = [
  'lib/workflow-input-contract.test.ts',
  'app/(dashboard)/_components/run-input-picker.test.ts',
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
    "    if (outcome.kind === 'canceled') return;",
    "    if (outcome.kind === 'canceled') { setInputBindings((previous) => { const next = { ...previous }; delete next[field.key]; return next; }); return; }"],
  // A failure that is computed and then thrown away — the original bug's shape.
  ['failure-computed-but-not-shown', COMPONENT,
    "    if (outcome.kind === 'failed') { setInputError(field.key, outcome.message); return; }",
    "    if (outcome.kind === 'failed') { return; }"],

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
    'disabled={setupSaving || blankRequired.length > 0 || missingRequiredInputs(inputContract, inputBindings).length > 0}',
    'disabled={setupSaving || blankRequired.length > 0}'],
  ['submit-guard-ignores-required-inputs', COMPONENT,
    'if (blankRequired.length || missingRequiredInputs(inputContract, inputBindings).length) return;',
    'if (blankRequired.length) return;'],
];

let killed = 0;
for (const [name, file, from, to] of mutants) {
  const dir = mkdtempSync(join(os.tmpdir(), `implexa-dash-run-input-${name}-`));
  try {
    cpSync(ROOT, dir, {
      recursive: true,
      filter: (src) => !['node_modules', '.next', '.git', '.vercel', 'dist'].includes(src.split('/').pop() ?? ''),
    });
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) {
      throw new Error(`${name}: mutation target must occur exactly once in ${file}`);
    }
    writeFileSync(target, source.replace(from, to));
    const result = spawnSync(process.execPath, ['--test', ...TESTS], { cwd: dir, encoding: 'utf8', timeout: 60000 });
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
