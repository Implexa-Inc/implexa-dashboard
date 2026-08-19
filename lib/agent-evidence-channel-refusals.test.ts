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

test('each refusal differs from the baseline at exactly the path it names', () => {
  // Without this, an entry could be refused for some unrelated reason — a wrong
  // contract version, say — and report coverage of a rule nothing exercises.
  for (const entry of corpus.refusals) {
    const rebuilt = withValueAt(corpus.baseline, entry.mutatedPath as Path, at(entry.projection, entry.mutatedPath as Path));
    assert.deepEqual(rebuilt, entry.projection, `${entry.name} changes more than ${(entry.mutatedPath as Path).join('.')}`);
  }
});

test('the corpus names every rule this parser enforces', () => {
  const names = new Set(corpus.refusals.map((entry) => entry.name));
  assert.equal(names.size, corpus.refusals.length, 'refusal names must be unique');
  for (const required of [
    'unsupported-contract-version', 'unexpected-top-level-key', 'missing-channel', 'invented-fifth-channel',
    'public-channel-withheld', 'answered-channel-claims-unavailable', 'withheld-form-with-wrong-status',
    'channel-extra-key', 'channel-status-not-canonical', 'run-count-negative', 'run-count-fractional',
    'timestamp-invalid-calendar-day', 'timestamp-normalized-noncanonical', 'timestamp-full-precision',
    'evidence-type-extra-key', 'evidence-type-withheld', 'evidence-type-counted-while-empty', 'evidence-type-hollow',
    'count-exceeds-run-count', 'channel-claims-evidence-it-lacks', 'channel-hides-evidence-it-has',
    'certification-authority-invented', 'neutral-benchmark-measured', 'neutral-benchmark-counted',
    'neutral-benchmark-timestamped', 'unknown-channel-holds-measured-evidence', 'measured-channel-holds-unmeasured-evidence',
  ]) assert.ok(names.has(required), `${required} is missing from the shared corpus`);
});
