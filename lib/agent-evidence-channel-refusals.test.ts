import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvidenceChannels } from './agent-evidence-channels.ts';
import corpus from '../test-fixtures/generated/marketplace-evidence-channels-refusals.v1.json' with { type: 'json' };

// The consumer half of the shared refusal contract. The backend runs the mirror
// of this file against the same corpus, so a rule that exists on only one side
// is a failing test here rather than a review finding later.
//
// Error wording is deliberately NOT part of this contract. The two
// implementations word refusals differently; the shared promise is "refused".

type Path = string[];
const PATHS = (entry: { mutatedPaths: unknown }): Path[] => entry.mutatedPaths as Path[];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const at = (value: unknown, keys: Path): unknown => keys.reduce<unknown>((node, key) => (node === undefined || node === null ? undefined : (node as Record<string, unknown>)[key]), value);
function withValueAt(root: unknown, keys: Path, value: unknown): unknown {
  const copy = clone(root) as Record<string, unknown>;
  let node = copy;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  const last = keys[keys.length - 1];
  if (value === undefined) delete node[last]; else node[last] = value;
  return copy;
}

test('the corpus baseline is accepted, or every refusal below proves nothing', () => {
  assert.equal(corpus.schema, 'implexa.marketplace-evidence-channels-refusals.v1');
  assert.equal(corpus.contractVersion, 'marketplace-evidence-channels.v1');
  const parsed = parseEvidenceChannels(clone(corpus.baseline));
  assert.equal(parsed.status, 'ready', parsed.status === 'unavailable' ? parsed.reason : '');
});

test('every projection the producer refuses is refused here too', () => {
  assert.ok(corpus.refusals.length >= 25, 'a corpus this small would not be covering the contract');
  for (const entry of corpus.refusals) {
    const parsed = parseEvidenceChannels(clone(entry.projection));
    assert.equal(parsed.status, 'unavailable', `${entry.name} was ACCEPTED by this parser but refused by the producer: ${entry.why}`);
    assert.ok(parsed.status === 'unavailable' && parsed.reason.length > 0, `${entry.name} must explain itself`);
  }
});

test('each refusal changes only the paths it declares', () => {
  // Minimality of the diff. It is NOT the isolation proof — one changed path is
  // not the same as one violated rule — but it stops a case from quietly
  // dragging in a second violation nobody reads in the JSON.
  for (const entry of corpus.refusals) {
    let rebuilt: unknown = corpus.baseline;
    for (const path of PATHS(entry)) rebuilt = withValueAt(rebuilt, path, at(entry.projection, path));
    assert.deepEqual(rebuilt, entry.projection, `${entry.name} changes more than ${PATHS(entry).map((path) => path.join('.')).join(', ')}`);
  }
});

test('every guard this parser enforces has at least one case that isolates it', () => {
  // The ISOLATION proof lives in the mutation harness: it deletes each guard in
  // turn and requires this suite to go red, which can only happen if some case
  // reaches that guard with every neighbouring invariant satisfied. What is
  // checked here is that no guard is missing a case at all.
  const rules = new Set(corpus.refusals.map((entry) => entry.rule));
  assert.deepEqual([...rules].sort(), corpus.rules, 'the declared rule list and the cases must agree');
  for (const rule of [
    'top-level-shape', 'contract-version', 'channels-whitelist', 'withheld-form-status', 'withheld-personal-fit-only',
    'channel-shape', 'channel-status-vocabulary', 'answered-channel-unavailable', 'run-count-bounded',
    'timestamp-canonical-day', 'evidence-keys-whitelist', 'evidence-entry-shape', 'evidence-status-vocabulary',
    'evidence-count-bounded', 'evidence-type-withheld', 'evidence-type-coherence', 'count-within-runs',
    'channel-coherence', 'certification-authority', 'neutral-benchmark-authority',
    'unknown-channel-coherence', 'measured-channel-coherence',
  ]) assert.ok(rules.has(rule), `${rule} has no isolated corpus case`);
  const names = new Set(corpus.refusals.map((entry) => entry.name));
  for (const required of ['run-count-not-a-number', 'run-count-fractional', 'run-count-negative',
    'evidence-count-not-a-number', 'evidence-count-fractional', 'evidence-count-negative']) {
    assert.ok(names.has(required), `${required} is missing`);
  }
});

test('refusal names are unique so a survivor can be named', () => {
  const names = new Set(corpus.refusals.map((entry) => entry.name));
  assert.equal(names.size, corpus.refusals.length);
  assert.ok(corpus.refusals.length >= 30, 'a corpus this small would not be covering the contract');
});
