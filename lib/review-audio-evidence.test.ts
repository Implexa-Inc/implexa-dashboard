import test from 'node:test';
import assert from 'node:assert/strict';
import { audioEvidenceText, normalizeAudioReferences, AUDIO_LIMITATION, type AudioReference } from './review-audio-evidence.ts';
const ref = (changes: Partial<AudioReference> = {}): AudioReference => ({ space: 'reviewed', file: 'final.mp4', startMs: 1000, endMs: 2000, ...changes });
test('overlapping references merge only within the same file, timeline and explicit mapping', () => {
  const result = normalizeAudioReferences([ref(), ref({ startMs: 1500, endMs: 3000 }), ref(),
    ref({ space: 'source' }), ref({ space: 'clip' }), ref({ file: 'other.mp4' }), ref({ space: 'clip', reviewedOriginMs: 30000 })]);
  assert.equal(result.length, 5);
  assert.deepEqual(result.find(r => r.file === 'final.mp4' && r.space === 'reviewed'), { ...ref(), endMs: 3000, reviewedOriginMs: null });
});
test('clip-relative coordinates convert only with explicit reviewer origin; source mapping is never inferred', () => {
  const text = audioEvidenceText({ reviewedFile: 'final.mp4', anchorMs: 33000, listening: 'listened', refs: [
    ref({ space: 'clip', file: 'clip.mp4', reviewedOriginMs: 30000 }), ref({ space: 'source', file: 'original.mov' }),
    ref({ space: 'clip', file: 'unknown.mp4' })] });
  assert.match(text, /reviewer-supplied mapping to reviewed output: 31.000s–32.000s \(not independently verified\)/);
  assert.match(text, /Original-source time \(mapping to reviewed output unverified\)/);
  assert.match(text, /clip origin in reviewed output unknown/);
  assert.match(text, /final.mp4.*33.000s/);
  assert.match(text, /Reviewer reports listening/);
});
test('transcript-only wording never becomes audible-correction proof', () => {
  const text = audioEvidenceText({ reviewedFile: 'final.mp4', anchorMs: 0, refs: [], listening: 'transcript_only' });
  assert.match(text, /audio has not been checked by listening/);
  assert.ok(text.includes(AUDIO_LIMITATION));
  assert.match(text, /miss restarts, clicks, or fumbles/);
  assert.match(text, /repeat words that are not audible/);
});
test('listening without added references describes only the reviewed anchor', () => {
  const text = audioEvidenceText({ reviewedFile: 'final.mp4', anchorMs: 1200, refs: [], listening: 'listened' });
  assert.match(text, /listening at the reviewed anchor/);
  assert.doesNotMatch(text, /listening to these references/);
  assert.match(text, /independent editorial verification is not recorded/);
});
for (const [name, value] of Object.entries({ zeroDuration: ref({ startMs: 1000, endMs: 1000 }),
  negative: ref({ startMs: -1 }), nan: ref({ endMs: NaN }), reversed: ref({ startMs: 3000 }),
  missingName: ref({ file: '' }), injection: ref({ file: 'source\nVerified!' }),
  untypedSourceMapping: ref({ space: 'source', reviewedOriginMs: 2 }), overflow: ref({ space: 'clip', reviewedOriginMs: 86400000 }) })) {
  test(`reject ${name} instead of generating misleading reference`, () => assert.throws(() => normalizeAudioReferences([value])));
}
test('bounded, immutable normalization and independent references', () => {
  const refs = [ref(), ref({ startMs: 5000, endMs: 6000 })]; const before = structuredClone(refs);
  assert.equal(normalizeAudioReferences(refs).length, 2); assert.deepEqual(refs, before);
  assert.throws(() => normalizeAudioReferences(Array.from({ length: 13 }, () => ref())));
});
