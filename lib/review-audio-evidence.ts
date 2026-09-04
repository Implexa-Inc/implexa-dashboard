// Reviewer-supplied context travels through the existing immutable issue body.
// This is not a QA verdict, source alignment attestation, or Manager receipt.
export type AudioReference = {
  space: 'reviewed' | 'source' | 'clip';
  file: string;
  startMs: number;
  endMs: number;
  // Only meaningful for a clip the reviewer explicitly mapped to reviewed output.
  reviewedOriginMs?: number | null;
};
export type Listening = 'listened' | 'transcript_only' | 'not_checked';
export const AUDIO_LIMITATION = 'Transcript wording can miss restarts, clicks, or fumbles and can repeat words that are not audible. Technical QA does not verify an editorial correction.';
const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 86400000;
export function normalizeAudioReferences(refs: AudioReference[]): AudioReference[] {
  if (!Array.isArray(refs) || refs.length > 12) throw new Error('Use at most 12 references.');
  const checked = refs.map(r => {
    if (!['reviewed', 'source', 'clip'].includes(r.space) || typeof r.file !== 'string'
      || !r.file.trim() || r.file.length > 200 || /[\r\n\x00-\x1f\x7f]/.test(r.file)
      || !validTime(r.startMs) || !validTime(r.endMs) || r.endMs <= r.startMs
      || (r.reviewedOriginMs != null && (r.space !== 'clip' || !validTime(r.reviewedOriginMs)
        || !validTime(r.reviewedOriginMs + r.endMs)))) {
      throw new Error('Name the reference and use a positive time range within 24 hours.');
    }
    return { ...r, file: r.file.trim(), reviewedOriginMs: r.reviewedOriginMs ?? null };
  });
  const key = (r: AudioReference) => JSON.stringify([r.space, r.file, r.reviewedOriginMs]);
  checked.sort((a, b) => key(a).localeCompare(key(b)) || a.startMs - b.startMs);
  const result: AudioReference[] = [];
  for (const r of checked) {
    const prev = result.at(-1);
    if (prev && key(prev) === key(r) && r.startMs <= prev.endMs) prev.endMs = Math.max(prev.endMs, r.endMs);
    else result.push({ ...r });
  }
  return result;
}
const time = (ms: number) => `${(ms / 1000).toFixed(3)}s`;
export function audioEvidenceText({ reviewedFile, anchorMs, refs, listening }: {
  reviewedFile: string; anchorMs: number; refs: AudioReference[]; listening: Listening;
}): string {
  if (!validTime(anchorMs) || !reviewedFile || /[\r\n\x00-\x1f\x7f]/.test(reviewedFile)
      || reviewedFile.length > 1000) throw new Error('The reviewed file and position are required.');
  const claims: Record<Listening, string> = {
    listened: 'Reviewer reports listening to these references; independent editorial verification is not recorded here.',
    transcript_only: 'Reviewer used transcript text only; audio has not been checked by listening.',
    not_checked: 'Listening has not been confirmed; these are locations to investigate.',
  };
  if (!Object.hasOwn(claims, listening)) throw new Error('Choose how the audio was checked.');
  const lines = normalizeAudioReferences(refs).map(r => {
    const where = r.space === 'reviewed' ? 'Reviewed-output time' : r.space === 'source' ? 'Original-source time (mapping to reviewed output unverified)' : 'Clip-relative time';
    const mapping = r.space !== 'clip' ? '' : r.reviewedOriginMs == null
      ? '; clip origin in reviewed output unknown'
      : `; reviewer-supplied mapping to reviewed output: ${time(r.reviewedOriginMs + r.startMs)}–${time(r.reviewedOriginMs + r.endMs)} (not independently verified)`;
    return `- ${where}, ${JSON.stringify(r.file)}: ${time(r.startMs)}–${time(r.endMs)}${mapping}`;
  });
  return [`Audio clarification for reviewed file ${JSON.stringify(reviewedFile)} at ${time(anchorMs)}.`,
    claims[listening], ...lines, AUDIO_LIMITATION].join('\n');
}
