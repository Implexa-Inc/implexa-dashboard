/**
 * lib/generation-source.ts — which source video a B-roll plan is cut into, and
 * how long the backend says it is.
 *
 * THE ONE RULE THIS MODULE EXISTS TO KEEP: the browser never invents a duration.
 *
 * It cannot. It has no access to the bytes, and every number it could reach for
 * — `size_bytes`, a filename, a `<video>` element's `duration` after a partial
 * fetch — is either a guess or an attacker-controlled value. The authoritative
 * length is probed by the Desktop from the exact validated bytes and stored on
 * the artifact row; this module READS it and refuses when it is absent. A
 * confidently-wrong ceiling is worse than no ceiling, because it would refuse
 * legitimate plans and accept illegitimate ones with equal confidence.
 *
 * WHAT THE BROWSER'S COPY IS FOR. Convenience, and only convenience: bounding a
 * slider, colouring an out-of-range field, and refusing before a round trip. The
 * backend is the gate and re-checks everything at preview, at create, and again
 * at approval against a fresh read. Nothing here can authorize anything.
 */

/** The canonical unit, matching the backend's `media_duration_ms`. */
export const MAX_MEDIA_DURATION_MS = 24 * 60 * 60 * 1000;

export type GenerationSource = {
  artifactId: string;
  relativePath: string;
  /** Authoritative, Desktop-probed. Null means NOT YET VERIFIED — never "unbounded". */
  mediaDurationMs: number | null;
};

/**
 * A source whose length is KNOWN. The narrowing is in the type on purpose: the
 * builders take this, so "an unverified source cannot reach paid compilation" is
 * a fact the compiler enforces rather than a check every component has to
 * remember to repeat.
 */
export type VerifiedGenerationSource = GenerationSource & { mediaDurationMs: number };

/**
 * Why paid generation cannot proceed, in the vocabulary the UI needs to act on.
 * These are DISTINCT states with distinct fixes, and collapsing them would leave
 * a user reading "unavailable" with nothing to do about it:
 *
 *   eligible            — exactly one verified source; compile away.
 *   needs_verification  — a source is there, its LENGTH is not. Open Desktop.
 *   ambiguous           — several sources; the user must choose which one.
 *   ineligible          — no validated final video at all. Nothing to cut into.
 *   unavailable         — the read failed. We do not know, and must not guess.
 */
export type GenerationSourceState =
  | { state: 'eligible'; source: VerifiedGenerationSource; sources: readonly GenerationSource[] }
  | { state: 'needs_verification'; sources: readonly GenerationSource[] }
  | { state: 'ambiguous'; sources: readonly GenerationSource[] }
  | { state: 'ineligible' }
  | { state: 'unavailable' };

const VIDEO_PATH = /\.(?:mp4|mov|m4v|webm)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Is this a duration the UI may treat as authoritative?
 *
 * Applied at the READ, not only at the write, because a row could carry anything
 * — and because the wire is JSON, where a `bigint` column can arrive as a string
 * from some drivers. A string is not a number and is refused rather than
 * coerced: silently accepting `"30000"` would mean the browser and the backend
 * disagree about what counts as verified.
 */
export function isAuthoritativeDurationMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_MEDIA_DURATION_MS;
}

/**
 * Classify the run's validated artifacts.
 *
 * FAIL CLOSED ON A MALFORMED ROW. A row whose shape we do not recognise is not
 * evidence that the run has no video — it means we cannot tell, and `unavailable`
 * is the honest answer. This mirrors the direct-route boundary the previous
 * `classifyGenerationEntryArtifacts` already drew, extended to the duration.
 */
export function classifyGenerationSource(
  rows: unknown,
  readError: unknown = null,
): GenerationSourceState {
  if (readError || !Array.isArray(rows)) return { state: 'unavailable' };

  const sources: GenerationSource[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { state: 'unavailable' };
    const artifact = row as Record<string, unknown>;
    if (typeof artifact.status !== 'string'
      || typeof artifact.relative_path !== 'string'
      || !(artifact.role === null || typeof artifact.role === 'string')) return { state: 'unavailable' };
    // A row that is present but has no usable id is malformed, not absent.
    if (!(typeof artifact.id === 'string' && UUID.test(artifact.id))) return { state: 'unavailable' };
    // `media_duration_ms` may legitimately be absent (a pre-0158 row) or null
    // (validated, not yet probed). Anything ELSE is a shape we do not
    // understand, and understanding it wrongly is how a fake ceiling gets in.
    const duration = artifact.media_duration_ms;
    if (!(duration === null || duration === undefined || typeof duration === 'number')) {
      return { state: 'unavailable' };
    }

    if (artifact.status !== 'validated' || artifact.role !== 'final_output') continue;
    if (!VIDEO_PATH.test(artifact.relative_path)) continue;
    sources.push({
      artifactId: artifact.id,
      relativePath: artifact.relative_path,
      mediaDurationMs: isAuthoritativeDurationMs(duration) ? duration : null,
    });
  }

  if (!sources.length) return { state: 'ineligible' };
  // MORE THAN ONE IS AMBIGUOUS, ALWAYS — even when only one of them has a
  // duration. Quietly preferring the verified one would pick the user's source
  // for them, and the file they meant might be the unverified one.
  if (sources.length > 1) return { state: 'ambiguous', sources };
  const [only] = sources;
  const duration = only.mediaDurationMs;
  if (duration === null) return { state: 'needs_verification', sources };
  return { state: 'eligible', source: { ...only, mediaDurationMs: duration }, sources };
}

/** Choosing a source by id, once the user has been shown the ambiguity. */
export function selectSource(
  sources: readonly GenerationSource[], artifactId: string | null,
): GenerationSource | null {
  if (!artifactId) return null;
  return sources.find((source) => source.artifactId === artifactId) ?? null;
}

/**
 * `1:04.500` — the source length, said the way a timeline reads.
 *
 * Milliseconds are shown because the boundary is millisecond-exact: a user whose
 * moment ends at 64.5 s on a 64.5 s source needs to see that those are the same
 * number, and `1:04` would make an exact fit look like an overrun.
 */
export function formatDurationMs(ms: number): string {
  if (!isAuthoritativeDurationMs(ms)) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** The duration as seconds, for input `max=` attributes. */
export function durationSeconds(ms: number): number {
  return isAuthoritativeDurationMs(ms) ? ms / 1000 : 0;
}

/**
 * The copy the user acts on. Every unavailable state names a NEXT STEP, because
 * "B-roll generation is unavailable" with no reason is a dead end — and for the
 * commonest case the next step is genuinely "open the desktop app", not anything
 * they can do in the browser.
 */
export const SOURCE_STATE_COPY: Record<Exclude<GenerationSourceState['state'], 'eligible'>, {
  title: string; body: string; action: string | null;
}> = {
  needs_verification: {
    title: "Implexa needs to check this video's length before generating.",
    body: 'Paid generation is bounded by the length of the source video, and only Implexa Desktop can measure it — it reads the file on your Mac, which the web app cannot. Open Implexa Desktop with this run and it will verify the video, then reload this page.',
    action: 'Open Implexa Desktop to verify this video’s duration.',
  },
  ambiguous: {
    title: 'This run has more than one final video.',
    body: 'Choose which one your B-roll is being cut into. Implexa will not pick for you: the moments you place are bounded by the length of the source, and the two files may not be the same length.',
    action: null,
  },
  ineligible: {
    title: 'This run has no validated final video.',
    body: 'B-roll generation is available only after the desktop app validates a final MP4, MOV, M4V, or WebM output.',
    action: null,
  },
  unavailable: {
    title: "Implexa couldn't verify this run's video.",
    body: 'The artifact check is unavailable right now. Reload before preparing paid generation — nothing should be approved from this state.',
    action: null,
  },
};

/**
 * THE BOUNDARY, for the browser's convenience checks only. `end <= duration`;
 * exact equality is valid, one millisecond beyond is not, and an unknown
 * duration is never unlimited.
 *
 * Deliberately takes MILLISECONDS, not the editor's seconds: converting once at
 * the call site and comparing integers is what keeps this agreeing with the
 * backend at the exact boundary, instead of comparing two floats that differ in
 * the last bit.
 */
export function withinSourceDuration(
  startMs: number, endMs: number, mediaDurationMs: number | null,
): boolean {
  if (!isAuthoritativeDurationMs(mediaDurationMs)) return false;
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) return false;
  if (startMs < 0 || endMs <= startMs) return false;
  return startMs < mediaDurationMs && endMs <= mediaDurationMs;
}
