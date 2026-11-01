/**
 * lib/review-recorder.ts — the Dashboard side of the Review Room recorder (spec L1).
 *
 * NET NEW. Nothing is superseded: before this, the Dashboard had no recorder and no
 * local recordings library. It REUSES, rather than parallels:
 *   - `parsePreviewUrl` / `revokePreview` (lib/review-preview.ts) for the
 *     `implexa-artifact://preview/<token>` URL a recording plays from, and its revoke;
 *   - the contain-fit letterbox math (lib/review-spatial-geometry.ts) that the Review
 *     Room's spatial overlay already uses, for drawing a moment's region.
 *
 * THE BOUNDARY. The full recording never leaves the Mac. The Desktop owns the files;
 * the Dashboard only ever sends it OPAQUE IDS (`recordingId`), a microphone boolean,
 * and draft moments. Nothing here accepts, builds, or forwards a filesystem path, and
 * `assertRecordingId` refuses anything that could carry one before the bridge is
 * called.
 *
 * NEVER TRUST A 200 (AGENTS.md: the anchor validator silently drops unknown keys, so a
 * client cannot feature-detect from a success). Every Desktop response is checked for
 * its EXACT shape — missing keys, extra keys, wrong types and out-of-range values are
 * all refused — and a malformed answer becomes a typed `RecorderError('response_invalid')`
 * rather than partially rendered state.
 *
 * Bridge contract version '2' (window.implexaDesktop.reviewRecorderContractVersion).
 */

import { overlayStyleForGeometry } from './review-spatial-geometry.ts';
import { desktopBridge, inDesktopApp, parsePreviewUrl } from './review-preview.ts';

export const REVIEW_RECORDER_CONTRACT_VERSION = '2';

/** Integer space shared with Review Room anchors (`normalized_visual_content_v1` × 1e6). */
export const COORD_MAX = 1_000_000;
export const MAX_MOMENT_MS = 30_000;
export const MAX_MOMENTS = 64;
export const CARD_FIELD_MAX = 600;
/** Region padding around the pointer box: 2% of the frame. */
export const POINTER_BOX_PAD = 20_000;
/** Dwell suggestion: the pointer stays within 1.5% of the frame for at least 1.2 s. */
export const DWELL_RADIUS = 15_000;
export const DWELL_MIN_MS = 1_200;
export const MAX_SUGGESTIONS = 12;
/** How much of the pointer's recent path the trail overlay draws. */
export const TRAIL_WINDOW_MS = 1_500;

export const CARD_FIELDS = ['whatToDo', 'why', 'insteadOf', 'howToCheck', 'whenNot'] as const;
export type CardField = typeof CARD_FIELDS[number];
export const CARD_FIELD_LABELS: Record<CardField, string> = {
  whatToDo: 'What to do',
  why: 'Why',
  insteadOf: 'Instead of what',
  howToCheck: 'How you would check it was done',
  whenNot: 'When not to do this',
};

// ── types ────────────────────────────────────────────────────────────────────

export const RECORDING_STATES = ['recording', 'finalizing', 'ready', 'interrupted', 'failed'] as const;
export type RecordingState = typeof RECORDING_STATES[number];
export const ACTIVE_STATES = ['permission_required', 'choosing', 'countdown', 'recording', 'paused', 'finalizing'] as const;
export type ActiveState = typeof ACTIVE_STATES[number];

export type Region = { x: number; y: number; width: number; height: number };
export type MomentCard = Record<CardField, string>;
export type Moment = {
  momentId: string;
  startMs: number;
  endMs: number;
  region: Region | null;
  card: MomentCard;
  createdAt: string;
};

/** `[tMs, x, y]` is a position; `[tMs]` means the pointer left the captured display. */
export type PointerSample = [number, number, number] | [number];
export type PointerTrack = {
  contractVersion: 'pointer-track.v1';
  videoWidth: number;
  videoHeight: number;
  samples: PointerSample[];
};

export type RecordingSummary = {
  recordingId: string;
  title: string;
  origin: 'recorded' | 'imported';
  state: RecordingState;
  failureReason: string | null;
  createdAt: string;
  durationMs: number | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  hasMicrophone: boolean;
  hasPointerTrack: boolean;
  momentCount: number;
};
export type RecordingDetail = RecordingSummary & { pointerTrack: PointerTrack | null; moments: Moment[] };
export type ActiveRecording = { recordingId: string; state: ActiveState };
export type LibraryUsage = { usedBytes: number; limitBytes: number };
export type RecordingPreview = { url: string; mime: 'video/mp4'; token: string };
const START_FAILURE_PHASES = ['display', 'recorder_construct', 'recorder_start', 'started_ack', 'countdown_deadline', 'other'] as const;
const START_ERROR_NAMES = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'NotSupportedError',
  'InvalidStateError', 'SecurityError', 'OverconstrainedError', 'TypeError', 'other'] as const;
const DISPLAY_FAILURE_REASONS = ['not_armed', 'frame_mismatch', 'phase', 'source_missing', 'sources_failed', 'source_binding_missing',
  'permission_media_types', 'permission_frame', 'permission_url', 'permission_consumed', 'permission_check', 'not_reported'] as const;
export type RecorderStartFailure = {
  phase: typeof START_FAILURE_PHASES[number];
  errorName: typeof START_ERROR_NAMES[number];
  reason: typeof DISPLAY_FAILURE_REASONS[number];
};
export type RecorderChange = { ownerId:string; recordingId: string; state: string; failure?: RecorderStartFailure };

export function recorderStartFailureMessage(failure: RecorderStartFailure): string {
  if (failure.reason === 'source_missing') return 'The selected screen or window disappeared before recording started. No recording was saved.';
  if (failure.reason === 'source_binding_missing') return 'Implexa could not verify the selected capture source. No recording was saved.';
  if (failure.phase === 'countdown_deadline') return 'Capture did not start in time. No recording was saved.';
  return failure.phase === 'display'
    ? 'Implexa could not capture the selected screen or window. No recording was saved.'
    : 'Video recording could not start. No recording was saved.';
}

// ── reasons ──────────────────────────────────────────────────────────────────

/** Every refusal the Desktop may return under contract '1'. */
export const DESKTOP_REASONS = [
  'forbidden', 'not_linked', 'recorder_busy', 'library_full', 'disk_full', 'media_tools_unavailable',
  'recording_not_found', 'recording_not_ready', 'moments_invalid', 'selection_cancelled', 'delete_cancelled',
  'import_unsupported', 'import_too_long', 'import_too_large', 'recorder_failed', 'recorder_operation_invalid',
] as const;
/** Refusals this module raises itself, before or after the bridge. */
export const CLIENT_REASONS = ['desktop_required', 'desktop_update_required', 'response_invalid', 'request_invalid'] as const;
export type RecorderReason = typeof DESKTOP_REASONS[number] | typeof CLIENT_REASONS[number];

export const REASON_MESSAGES: Record<RecorderReason, string> = {
  forbidden: 'Implexa Desktop only accepts recorder requests from its own app window. Reopen this page from Implexa Desktop and try again.',
  not_linked: 'Sign in to Implexa Desktop with this account to use recordings.',
  recorder_busy: 'That recording is busy right now. Try again in a moment.',
  library_full: 'Your recordings library is full (10 GB). Delete a recording to make room.',
  disk_full: 'This Mac is out of disk space. Free some space and try again.',
  media_tools_unavailable: 'Recording needs the media tools (ffmpeg) on this Mac, and Implexa Desktop could not find them. Update Implexa Desktop or install ffmpeg, then try again.',
  recording_not_found: 'This recording is no longer in your library on this Mac.',
  recording_not_ready: 'This recording is still being saved. Try again in a moment.',
  moments_invalid: 'Implexa Desktop could not save these moments. Check each range is inside the recording and at most 30 seconds, then save again.',
  selection_cancelled: 'No file was chosen.',
  delete_cancelled: 'The recording was not deleted.',
  import_unsupported: 'That video could not be added: it is not an MP4, MOV, M4V or WebM file, or it could not be converted. Try another file.',
  import_too_long: 'That video is too long to add to your recordings library.',
  import_too_large: 'That video is too large to add to your recordings library.',
  recorder_failed: 'The recorder hit a problem. Your other recordings are unaffected. Try again.',
  recorder_operation_invalid: 'Implexa Desktop did not recognise that recorder request. Update Implexa Desktop, then reload this page.',
  desktop_required: 'Recording needs the Implexa desktop app. Open this page in Implexa Desktop to record, upload or play recordings.',
  desktop_update_required: `Recording needs the Implexa desktop app with review recorder version ${REVIEW_RECORDER_CONTRACT_VERSION}. Update Implexa Desktop, then reload this page.`,
  response_invalid: 'Implexa Desktop sent an answer this page could not verify, so nothing was changed here. Update Implexa Desktop and try again.',
  request_invalid: 'That request could not be sent to Implexa Desktop.',
};

/** Cancelling a native dialog is the user's choice, not an error to display. */
export const SILENT_REASONS: ReadonlySet<RecorderReason> = new Set(['selection_cancelled', 'delete_cancelled']);

const DESKTOP_REASON_SET: ReadonlySet<string> = new Set(DESKTOP_REASONS);

/** Why a recording is `failed` (Desktop packet `failureReason`). Never shown raw. */
export const FAILURE_REASONS = ['empty_capture', 'finalize_failed', 'too_long', 'too_large', 'source_changed', 'media_tools_unavailable'] as const;
export type FailureReason = typeof FAILURE_REASONS[number];
export const FAILURE_REASON_MESSAGES: Record<FailureReason, string> = {
  empty_capture: 'Nothing was captured, so there is nothing to play.',
  finalize_failed: 'The video could not be finished or converted into a playable file.',
  too_long: 'The video is longer than the recordings library allows.',
  too_large: 'The video is larger than the recordings library allows.',
  source_changed: 'The original file changed while it was being added, so the copy was not kept.',
  media_tools_unavailable: 'The media tools (ffmpeg) were not available to finish this video.',
};
const FAILURE_REASON_SET: ReadonlySet<string> = new Set(FAILURE_REASONS);
export const failureMessage = (reason: string | null): string =>
  reason !== null && FAILURE_REASON_SET.has(reason) ? FAILURE_REASON_MESSAGES[reason as FailureReason] : 'This recording could not be saved.';

export class RecorderError extends Error {
  readonly reason: RecorderReason;
  constructor(reason: RecorderReason) {
    super(REASON_MESSAGES[reason]);
    this.reason = reason;
  }
  get silent(): boolean { return SILENT_REASONS.has(this.reason); }
}

/**
 * The one user-facing message for anything a recorder call threw. Cancels are silent
 * (null); anything that is not a RecorderError gets the generic recorder message.
 */
export function recorderErrorMessage(caught: unknown): string | null {
  if (caught instanceof RecorderError) return caught.silent ? null : caught.message;
  return REASON_MESSAGES.recorder_failed;
}

export function reasonMessage(reason: string): string {
  return Object.hasOwn(REASON_MESSAGES, reason)
    ? REASON_MESSAGES[reason as RecorderReason]
    : REASON_MESSAGES.recorder_failed;
}

// ── shape validation ─────────────────────────────────────────────────────────

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const MAX_TITLE = 512;
/** Two hours at 60 Hz with headroom. A track larger than this is not one we draw. */
const MAX_POINTER_SAMPLES = 1_000_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
/** Exactly these keys: a missing key and an extra key are both refusals. */
function exact(v: unknown, keys: readonly string[]): v is Obj {
  return isObj(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
}
const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const posInt = (v: unknown): v is number => nonNegInt(v) && v > 0;
const coord = (v: unknown): v is number => nonNegInt(v) && v <= COORD_MAX;
const isoDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && Number.isFinite(Date.parse(v));
const nullable = <T>(check: (v: unknown) => v is T) => (v: unknown): v is T | null => v === null || check(v);

/** Recording ids are UUID v4 (Desktop contract) — so a value that passes cannot carry a path. */
export const isRecordingId = (v: unknown): v is string => typeof v === 'string' && UUID_V4.test(v);
export const isMomentId = (v: unknown): v is string => typeof v === 'string' && UUID_V4.test(v);

const SUMMARY_KEYS = ['recordingId', 'title', 'origin', 'state', 'failureReason', 'createdAt', 'durationMs',
  'sizeBytes', 'width', 'height', 'hasMicrophone', 'hasPointerTrack', 'momentCount'] as const;
const DETAIL_KEYS = [...SUMMARY_KEYS, 'pointerTrack', 'moments'] as const;
const MOMENT_KEYS = ['momentId', 'startMs', 'endMs', 'region', 'card', 'createdAt'] as const;
const REGION_KEYS = ['x', 'y', 'width', 'height'] as const;

function summaryFieldsValid(v: Obj): boolean {
  return isRecordingId(v.recordingId)
    && typeof v.title === 'string' && v.title.length <= MAX_TITLE
    && (v.origin === 'recorded' || v.origin === 'imported')
    && (RECORDING_STATES as readonly unknown[]).includes(v.state)
    && (v.failureReason === null || (typeof v.failureReason === 'string' && FAILURE_REASON_SET.has(v.failureReason)))
    && isoDate(v.createdAt)
    && nullable(nonNegInt)(v.durationMs)
    && nullable(nonNegInt)(v.sizeBytes)
    && nullable(posInt)(v.width)
    && nullable(posInt)(v.height)
    && typeof v.hasMicrophone === 'boolean'
    && typeof v.hasPointerTrack === 'boolean'
    && nonNegInt(v.momentCount) && v.momentCount <= MAX_MOMENTS
    // A ready recording is playable, so its length is known; the player and every
    // moment bound depend on it.
    && (v.state !== 'ready' || v.durationMs !== null);
}

export function isRecordingSummary(v: unknown): v is RecordingSummary {
  return exact(v, SUMMARY_KEYS) && summaryFieldsValid(v);
}

export function isRegion(v: unknown): v is Region {
  return exact(v, REGION_KEYS)
    && coord(v.x) && coord(v.y) && coord(v.width) && coord(v.height)
    && (v.width as number) >= 1 && (v.height as number) >= 1
    && (v.x as number) + (v.width as number) <= COORD_MAX
    && (v.y as number) + (v.height as number) <= COORD_MAX;
}

export function isMomentCard(v: unknown): v is MomentCard {
  return exact(v, CARD_FIELDS)
    && CARD_FIELDS.every((k) => typeof v[k] === 'string' && (v[k] as string).length <= CARD_FIELD_MAX);
}

/** One moment, against the recording's duration (the range must sit inside it). */
export function isMoment(v: unknown, durationMs: number): v is Moment {
  return exact(v, MOMENT_KEYS)
    && isMomentId(v.momentId)
    && nonNegInt(v.startMs) && nonNegInt(v.endMs)
    && (v.startMs as number) <= (v.endMs as number)
    && nonNegInt(durationMs) && (v.endMs as number) <= durationMs
    && (v.endMs as number) - (v.startMs as number) <= MAX_MOMENT_MS
    && (v.region === null || isRegion(v.region))
    && isMomentCard(v.card)
    && isoDate(v.createdAt);
}

/** A whole moments list: at most 64, unique ids, each valid. */
export function isMomentList(v: unknown, durationMs: number | null): v is Moment[] {
  if (!Array.isArray(v) || v.length > MAX_MOMENTS) return false;
  if (v.length === 0) return true;
  if (durationMs === null) return false;
  const ids = new Set<string>();
  for (const m of v) {
    if (!isMoment(m, durationMs) || ids.has(m.momentId)) return false;
    ids.add(m.momentId);
  }
  return true;
}

export function isPointerTrack(v: unknown): v is PointerTrack {
  if (!exact(v, ['contractVersion', 'videoWidth', 'videoHeight', 'samples'])
    || v.contractVersion !== 'pointer-track.v1'
    || !posInt(v.videoWidth) || !posInt(v.videoHeight)
    || !Array.isArray(v.samples) || v.samples.length > MAX_POINTER_SAMPLES) return false;
  let last = -1;
  for (const s of v.samples as unknown[]) {
    if (!Array.isArray(s) || !nonNegInt(s[0]) || s[0] < last) return false;
    if (s.length === 3) { if (!coord(s[1]) || !coord(s[2])) return false; }
    else if (s.length !== 1) return false;
    last = s[0];
  }
  return true;
}

export function isRecordingDetail(v: unknown): v is RecordingDetail {
  if (!exact(v, DETAIL_KEYS) || !summaryFieldsValid(v)) return false;
  if (!(v.pointerTrack === null || isPointerTrack(v.pointerTrack))) return false;
  // The summary's own claims must agree with what it carries.
  if (v.hasPointerTrack !== (v.pointerTrack !== null)) return false;
  if (!isMomentList(v.moments, v.durationMs as number | null)) return false;
  return (v.moments as unknown[]).length === v.momentCount;
}

export function isLibraryUsage(v: unknown): v is LibraryUsage {
  return exact(v, ['usedBytes', 'limitBytes']) && nonNegInt(v.usedBytes) && posInt(v.limitBytes);
}

export function isActiveRecording(v: unknown): v is ActiveRecording {
  return exact(v, ['recordingId', 'state']) && isRecordingId(v.recordingId)
    && (ACTIVE_STATES as readonly unknown[]).includes(v.state);
}

export function isRecorderChange(v: unknown): v is RecorderChange {
  if (!isObj(v) || !exact(v, v.state === 'start_failed' ? ['ownerId', 'recordingId', 'state', 'failure'] : ['ownerId', 'recordingId', 'state'])
    || typeof v.ownerId !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.ownerId)
    || !isRecordingId(v.recordingId) || typeof v.state !== 'string' || v.state.length === 0 || v.state.length > 64) return false;
  if (v.state !== 'start_failed') return true;
  return exact(v.failure, ['phase', 'errorName', 'reason'])
    && (START_FAILURE_PHASES as readonly unknown[]).includes(v.failure.phase)
    && (START_ERROR_NAMES as readonly unknown[]).includes(v.failure.errorName)
    && (DISPLAY_FAILURE_REASONS as readonly unknown[]).includes(v.failure.reason);
}

// ── per-operation response parsers (pure; exported for tests) ────────────────

/** A refusal is `{ok:false, reason}` exactly, with a reason from the contract. */
function refusal(v: unknown): RecorderError | null {
  if (!isObj(v) || v.ok !== false) return null;
  if (!exact(v, ['ok', 'reason']) || typeof v.reason !== 'string' || !DESKTOP_REASON_SET.has(v.reason)) {
    return new RecorderError('response_invalid');
  }
  return new RecorderError(v.reason as RecorderReason);
}

/** More rows than this is not a library this page will render. */
const MAX_LIBRARY_ROWS = 10_000;

export const parse = {
  start(v: unknown): { recordingId: string } {
    if (exact(v, ['ok', 'recordingId']) && v.ok === true && isRecordingId(v.recordingId)) return { recordingId: v.recordingId };
    throw refusal(v) ?? new RecorderError('response_invalid');
  },
  import(v: unknown): { recordingId: string } { return parse.start(v); },
  status(v: unknown): { active: ActiveRecording | null } {
    if (exact(v, ['ok', 'active']) && v.ok === true && (v.active === null || isActiveRecording(v.active))) {
      return { active: v.active as ActiveRecording | null };
    }
    throw refusal(v) ?? new RecorderError('response_invalid');
  },
  /**
   * The envelope is strict; ROWS are not all-or-nothing. A malformed row (or a repeated
   * id) is dropped and counted, so one unreadable recording cannot hide the library.
   */
  list(v: unknown): { recordings: RecordingSummary[]; library: LibraryUsage; unreadable: number } {
    if (exact(v, ['ok', 'recordings', 'library']) && v.ok === true
      && Array.isArray(v.recordings) && v.recordings.length <= MAX_LIBRARY_ROWS && isLibraryUsage(v.library)) {
      const seen = new Set<string>();
      const recordings: RecordingSummary[] = [];
      for (const row of v.recordings as unknown[]) {
        if (!isRecordingSummary(row) || seen.has(row.recordingId)) continue;
        seen.add(row.recordingId);
        recordings.push(row);
      }
      return { recordings, library: v.library, unreadable: v.recordings.length - recordings.length };
    }
    throw refusal(v) ?? new RecorderError('response_invalid');
  },
  get(v: unknown, recordingId: string): RecordingDetail {
    if (exact(v, ['ok', 'recording']) && v.ok === true && isRecordingDetail(v.recording)
      && v.recording.recordingId === recordingId) return v.recording;
    throw refusal(v) ?? new RecorderError('response_invalid');
  },
  preview(v: unknown): RecordingPreview {
    if (exact(v, ['ok', 'url', 'mime', 'token']) && v.ok === true && v.mime === 'video/mp4'
      && typeof v.token === 'string' && parsePreviewUrl(v.url)?.token === v.token) {
      return { url: v.url as string, mime: 'video/mp4', token: v.token };
    }
    throw refusal(v) ?? new RecorderError('response_invalid');
  },
  saveMoments(v: unknown, durationMs: number): Moment[] {
    if (exact(v, ['ok', 'moments']) && v.ok === true && isMomentList(v.moments, durationMs)) return v.moments;
    throw refusal(v) ?? new RecorderError('response_invalid');
  },
  done(v: unknown): void {
    if (exact(v, ['ok']) && v.ok === true) return;
    throw refusal(v) ?? new RecorderError('response_invalid');
  },
};

// ── the bridge ───────────────────────────────────────────────────────────────

type RecorderBridge = {
  reviewRecorderContractVersion?: unknown;
  reviewRecorder?: unknown;
  onReviewRecorderChanged?: unknown;
};
type InvokeFn = (operation: string, args?: object) => Promise<unknown>;

const bridgeOf = (win?: unknown) => desktopBridge<RecorderBridge>(win);

export type RecorderAvailability =
  | { state: 'ready' }
  | { state: 'desktop_required' | 'desktop_update_required'; message: string };

/**
 * Mirrors the training-source gate: no bridge at all is "open this in Desktop"; a
 * bridge with a different recorder contract is "update Desktop". Neither is guessed
 * around — an unknown version is not assumed compatible.
 */
export function recorderAvailability(win?: unknown): RecorderAvailability {
  const b = bridgeOf(win);
  if (!b || typeof b.reviewRecorder !== 'function') {
    // An older Desktop exposes the bridge object but not the recorder.
    const reason = inDesktopApp(win) ? 'desktop_update_required' : 'desktop_required';
    return { state: reason, message: REASON_MESSAGES[reason] };
  }
  if (b.reviewRecorderContractVersion !== REVIEW_RECORDER_CONTRACT_VERSION) {
    return { state: 'desktop_update_required', message: REASON_MESSAGES.desktop_update_required };
  }
  return { state: 'ready' };
}

function assertRecordingId(recordingId: unknown): asserts recordingId is string {
  if (!isRecordingId(recordingId)) throw new RecorderError('request_invalid');
}

export type ReviewRecorderClient = ReturnType<typeof createReviewRecorderClient>;

/**
 * The only module that talks to `reviewRecorder`. Pages call these methods and never
 * the bridge, so the "ids only" rule is enforced in one place (and tested there).
 */
export function createReviewRecorderClient(win?: unknown, expectedOwnerId?: string) {
  function invoker(): InvokeFn {
    const availability = recorderAvailability(win);
    if (availability.state !== 'ready') throw new RecorderError(availability.state);
    const b = bridgeOf(win)!;
    return (b.reviewRecorder as InvokeFn).bind(b);
  }
  async function call(operation: string, args?: object): Promise<unknown> {
    const invoke = invoker();
    if (typeof expectedOwnerId !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(expectedOwnerId)) throw new RecorderError('not_linked');
    try {
      return await invoke(operation, {...args, expectedOwnerId});
    } catch {
      // A throw across the bridge is not a contract answer.
      throw new RecorderError('recorder_failed');
    }
  }

  return {
    async start(microphone: boolean) {
      if (typeof microphone !== 'boolean') throw new RecorderError('request_invalid');
      return parse.start(await call('start', { microphone }));
    },
    async status() { return parse.status(await call('status')); },
    async list() { return parse.list(await call('list')); },
    async get(recordingId: string) {
      assertRecordingId(recordingId);
      return parse.get(await call('get', { recordingId }), recordingId);
    },
    async preview(recordingId: string) {
      assertRecordingId(recordingId);
      return parse.preview(await call('preview', { recordingId }));
    },
    async saveMoments(recordingId: string, moments: Moment[], durationMs: number) {
      assertRecordingId(recordingId);
      // Checked here too, so an invalid draft is caught without a round trip — the
      // Desktop still validates and its answer replaces local state.
      if (!isMomentList(moments, durationMs)) throw new RecorderError('moments_invalid');
      return parse.saveMoments(await call('saveMoments', { recordingId, moments }), durationMs);
    },
    async importVideo() { return parse.import(await call('import')); },
    async recover(recordingId: string) {
      assertRecordingId(recordingId);
      parse.done(await call('recover', { recordingId }));
    },
    async remove(recordingId: string) {
      assertRecordingId(recordingId);
      parse.done(await call('delete', { recordingId }));
    },
    /** Change events; malformed ones are dropped. Returns an unsubscribe. */
    subscribe(cb: (e: RecorderChange) => void): () => void {
      const b = bridgeOf(win);
      if (recorderAvailability(win).state !== 'ready' || typeof b?.onReviewRecorderChanged !== 'function') return () => {};
      let off: unknown;
      try {
        off = (b.onReviewRecorderChanged as (fn: (e: unknown) => void) => unknown)((e) => { if (isRecorderChange(e) && e.ownerId===expectedOwnerId) cb(e); });
      } catch { return () => {}; }
      return () => { if (typeof off === 'function') { try { off(); } catch { /* already gone */ } } };
    },
  };
}

// ── pure moment helpers ──────────────────────────────────────────────────────

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * Any two times → a valid moment range: ordered, integer, inside [0, duration], and at
 * most 30 s (the end is pulled back to start + 30 s). Null for a non-finite input or
 * an unknown duration.
 */
export function clampMomentRange(aMs: number, bMs: number, durationMs: number): { startMs: number; endMs: number } | null {
  if (![aMs, bMs].every(Number.isFinite) || !nonNegInt(durationMs)) return null;
  const startMs = clampInt(Math.min(aMs, bMs), 0, durationMs);
  const endMs = Math.min(clampInt(Math.max(aMs, bMs), 0, durationMs), startMs + MAX_MOMENT_MS);
  return { startMs, endMs };
}

/**
 * A drag (or an M…M mark) from `anchorMs` to `headMs`. Unlike `clampMomentRange`, the
 * ANCHOR is kept: dragging left past 30 s pulls the start toward the anchor, not the
 * end away from it. `snapMs` rounds both ends (the range bar snaps to 100 ms).
 */
export function rangeFromDrag(anchorMs: number, headMs: number, durationMs: number, snapMs = 0): { startMs: number; endMs: number } | null {
  if (![anchorMs, headMs].every(Number.isFinite) || !nonNegInt(durationMs)) return null;
  const snap = (v: number) => (snapMs > 0 ? Math.round(v / snapMs) * snapMs : v);
  const anchor = clampInt(snap(anchorMs), 0, durationMs);
  const head = clampInt(Math.min(anchor + MAX_MOMENT_MS, Math.max(anchor - MAX_MOMENT_MS, snap(headMs))), 0, durationMs);
  return { startMs: Math.min(anchor, head), endMs: Math.max(anchor, head) };
}

/** Normalized float rect (0..1) → the integer region space, never exceeding the frame. */
function regionFromNormalized(r: { x: number; y: number; width: number; height: number }): Region | null {
  const x = clampInt(r.x * COORD_MAX, 0, COORD_MAX - 1);
  const y = clampInt(r.y * COORD_MAX, 0, COORD_MAX - 1);
  const width = clampInt(r.width * COORD_MAX, 1, COORD_MAX - x);
  const height = clampInt(r.height * COORD_MAX, 1, COORD_MAX - y);
  const region = { x, y, width, height };
  return isRegion(region) ? region : null;
}

/** A click (or Enter) on the picture marks a box this big, centered on the point. */
export const POINT_REGION_SIZE = 200_000;

/**
 * What the Review Room's spatial overlay produced (normalized 0..1, letterbox already
 * excluded by its contain-fit math) → a moment region in the video frame's integer
 * space. A drag is its rectangle; a click or the overlay's keyboard Enter is a point,
 * which becomes a 20% box centered on it and kept inside the frame.
 */
export function regionFromSpatial(geometry: { kind: 'point' | 'rect'; x: number; y: number; width: number | null; height: number | null }): Region | null {
  if (![geometry.x, geometry.y].every(Number.isFinite)) return null;
  if (geometry.kind === 'rect') {
    if (!Number.isFinite(geometry.width) || !Number.isFinite(geometry.height)) return null;
    return regionFromNormalized({ x: geometry.x, y: geometry.y, width: geometry.width as number, height: geometry.height as number });
  }
  const half = POINT_REGION_SIZE / 2;
  const cx = Math.min(COORD_MAX - half, Math.max(half, Math.round(geometry.x * COORD_MAX)));
  const cy = Math.min(COORD_MAX - half, Math.max(half, Math.round(geometry.y * COORD_MAX)));
  const region = { x: cx - half, y: cy - half, width: POINT_REGION_SIZE, height: POINT_REGION_SIZE };
  return isRegion(region) ? region : null;
}

/** Percent CSS for drawing a region over the element box (letterbox folded in). */
export function regionOverlayStyle(region: Region, el: { elementWidth: number; elementHeight: number; videoWidth: number; videoHeight: number }) {
  return overlayStyleForGeometry(
    { kind: 'rect', x: region.x / COORD_MAX, y: region.y / COORD_MAX, width: region.width / COORD_MAX, height: region.height / COORD_MAX },
    { elementWidth: el.elementWidth, elementHeight: el.elementHeight, naturalWidth: el.videoWidth, naturalHeight: el.videoHeight },
  );
}

type Positioned = [number, number, number];
const isPositioned = (s: PointerSample): s is Positioned => s.length === 3;

/** Index of the first sample with t > tMs (samples are time-ordered). */
function upperBound(samples: readonly PointerSample[], tMs: number): number {
  let lo = 0; let hi = samples.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid][0] <= tMs) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * Where to start reading the pointer AS OF `tMs`: the last sample at or before it. The
 * sampler records nothing while the pointer is still, so that sample (if it is a
 * position, not a gap) is where the pointer rested at `tMs` — a cursor parked for the
 * whole range must still count as being there.
 */
function seedIndex(samples: readonly PointerSample[], tMs: number): number {
  return Math.max(0, upperBound(samples, tMs) - 1);
}

/**
 * The moment's default region: the box the pointer occupied during [startMs, endMs]
 * (including where it rested when the range began), padded by 2% of the frame on every
 * side and clamped to it. Null when the pointer was never on the captured display.
 */
export function defaultRegionFromPointer(samples: readonly PointerSample[] | null | undefined, startMs: number, endMs: number): Region | null {
  if (!samples?.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = seedIndex(samples, startMs); i < samples.length && samples[i][0] <= endMs; i++) {
    const s = samples[i];
    if (!isPositioned(s)) continue;
    minX = Math.min(minX, s[1]); maxX = Math.max(maxX, s[1]);
    minY = Math.min(minY, s[2]); maxY = Math.max(maxY, s[2]);
  }
  if (minX === Infinity) return null;
  const x = Math.max(0, minX - POINTER_BOX_PAD);
  const y = Math.max(0, minY - POINTER_BOX_PAD);
  const region = {
    x, y,
    width: Math.max(1, Math.min(COORD_MAX, maxX + POINTER_BOX_PAD) - x),
    height: Math.max(1, Math.min(COORD_MAX, maxY + POINTER_BOX_PAD) - y),
  };
  if (region.x + region.width > COORD_MAX) region.x = COORD_MAX - region.width;
  if (region.y + region.height > COORD_MAX) region.y = COORD_MAX - region.height;
  return isRegion(region) ? region : null;
}

export type SuggestedMoment = { startMs: number; endMs: number; region: Region | null };

/**
 * Dwell suggestions: ranges where the pointer stayed within 1.5% of the frame of where
 * the dwell began for at least 1.2 s. Samples may be sparse (a still pointer emits
 * nothing), so a dwell lasts until the first sample that LEAVES the radius, the
 * pointer leaving the display (a gap sample), or the end of the recording.
 *
 * At most 12 are returned — the longest dwells, in time order — each at most 30 s.
 */
export function suggestMoments(samples: readonly PointerSample[] | null | undefined, durationMs: number): SuggestedMoment[] {
  if (!samples?.length || !nonNegInt(durationMs)) return [];
  const found: Array<{ startMs: number; endMs: number; dwellMs: number }> = [];
  const r2 = DWELL_RADIUS * DWELL_RADIUS;
  let i = 0;
  while (i < samples.length) {
    const a = samples[i];
    if (!isPositioned(a)) { i++; continue; }
    let j = i + 1;
    while (j < samples.length) {
      const s = samples[j];
      if (!isPositioned(s)) break;
      const dx = s[1] - a[1]; const dy = s[2] - a[2];
      if (dx * dx + dy * dy > r2) break;
      j++;
    }
    const endMs = Math.min(durationMs, j < samples.length ? samples[j][0] : durationMs);
    const dwellMs = endMs - a[0];
    if (a[0] <= durationMs && dwellMs >= DWELL_MIN_MS) {
      found.push({ startMs: a[0], endMs: Math.min(endMs, a[0] + MAX_MOMENT_MS), dwellMs });
      i = j;
    } else {
      i++;
    }
  }
  return found
    .sort((p, q) => q.dwellMs - p.dwellMs || p.startMs - q.startMs)
    .slice(0, MAX_SUGGESTIONS)
    .sort((p, q) => p.startMs - q.startMs)
    .map(({ startMs, endMs }) => ({ startMs, endMs, region: defaultRegionFromPointer(samples, startMs, endMs) }));
}

/**
 * The trail to draw at `tMs`: the pointer's path over the last 1.5 s (starting from
 * where it was 1.5 s ago, so a still pointer keeps its dot), split into runs wherever
 * it left the display, so the trail never draws a line across a gap.
 */
export function pointerTrailAt(samples: readonly PointerSample[] | null | undefined, tMs: number, windowMs = TRAIL_WINDOW_MS): Array<Array<[number, number]>> {
  if (!samples?.length || !Number.isFinite(tMs)) return [];
  const runs: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  for (let i = seedIndex(samples, tMs - windowMs); i < samples.length && samples[i][0] <= tMs; i++) {
    const s = samples[i];
    if (isPositioned(s)) run.push([s[1], s[2]]);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs;
}

export const emptyCard = (): MomentCard => ({ whatToDo: '', why: '', insteadOf: '', howToCheck: '', whenNot: '' });

/** Do two ranges overlap (touching ends do not count)? */
export const rangesOverlap = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  a.startMs < b.endMs && b.startMs < a.endMs;

/**
 * Append a new draft moment, or refuse (null) when the list is full, the range is
 * empty (start === end — from the bar or from M…M alike), or it is not a valid moment. `momentId` comes from `crypto.randomUUID()` at the call site.
 */
export function addMoment(
  moments: readonly Moment[],
  draft: { startMs: number; endMs: number; region: Region | null },
  durationMs: number,
  ids: { momentId: string; createdAt: string },
): Moment[] | null {
  if (moments.length >= MAX_MOMENTS) return null;
  // A new mark needs a span. (A stored zero-length moment is still valid contract data.)
  if (draft.endMs <= draft.startMs) return null;
  const moment: Moment = { momentId: ids.momentId, startMs: draft.startMs, endMs: draft.endMs, region: draft.region, card: emptyCard(), createdAt: ids.createdAt };
  if (!isMoment(moment, durationMs) || moments.some((m) => m.momentId === moment.momentId)) return null;
  return [...moments, moment].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** Has the local list moved away from what the Desktop last stored? */
export function momentsDirty(saved: readonly Moment[], local: readonly Moment[]): boolean {
  return JSON.stringify(saved) !== JSON.stringify(local);
}

// ── display helpers ──────────────────────────────────────────────────────────

/** `1:04` or `1:02:03` — library durations, said the way a player reads. */
export function formatRecordingDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Binary units labelled KB/MB/GB: the Desktop's library limit is 10 GiB
 * (10 737 418 240 bytes), which must read as the "10 GB" the copy promises.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes; let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${u === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** Spec §3.5 — the exact, whole notice under the Record button. */
export const RECORD_NOTICE = 'Recordings stay on this Mac. Only the moments and screenshots you choose are saved to your Agent, where the AI that runs and checks it can see them.';
export const MOMENTS_NEXT_NOTE = 'Saved moments remain drafts. Use in Training preserves their notes as annotation; review and accept any teaching separately.';

/** The player route for a recording. Ids are opaque and URL-safe by contract. */
export const recordingPlayerHref = (recordingId: string) => `/review/recordings/${encodeURIComponent(recordingId)}`;

export const RECORDING_STATE_LABELS: Record<RecordingState, string> = {
  recording: 'Recording', finalizing: 'Saving…', ready: 'Ready', interrupted: 'Interrupted', failed: 'Failed',
};
export const ACTIVE_STATE_LABELS: Record<ActiveState, string> = {
  permission_required: 'Allow Screen Recording in the recorder window before choosing a screen. No recording has started.',
  choosing: 'Choose a screen or window in the recorder window.',
  countdown: 'Starting…',
  recording: 'Recording. Use the floating control bar to pause or stop.',
  paused: 'Paused. Use the floating control bar to resume or stop.',
  finalizing: 'Saving your recording…',
};

/**
 * Recover finalizes what was saved of an interrupted recording, and also retries a
 * failed RECORDED one (the Desktop keeps its raw capture). An upload that failed has
 * nothing to retry: it is deleted and added again.
 */
export function recoverAction(r: Pick<RecordingSummary, 'state' | 'origin'>): { label: 'Recover' | 'Try again' } | null {
  if (r.state === 'interrupted') return { label: 'Recover' };
  if (r.state === 'failed' && r.origin === 'recorded') return { label: 'Try again' };
  return null;
}

// ── card text rules (spec §3.3) ──────────────────────────────────────────────

export const WHAT_TO_DO_MIN = 12;
export const WHAT_TO_DO_MAX = 300;
export const LEARNING_REFUSAL_PREFIX = 'This will be refused when it becomes a learning';

/**
 * The learning text rules (backend `learning_text_violation`: no URLs, paths, emails,
 * @handles, runs of 7+ digits, file names), checked as the Coach types. These are
 * WARNINGS, not blocks: a card is a draft until a later slice turns it into a learning,
 * and that is where the backend refuses. Order matters only for the message order.
 */
const TEXT_RULES: ReadonlyArray<[string, RegExp]> = [
  ['a web address', /\b(?:https?:\/\/|www\.)\S+/i],
  ['an email address', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/],
  ['an @handle', /(?:^|[^\w@.])@[A-Za-z0-9_]{2,}/],
  ['a file path', /(?:^|[\s("'])(?:~|\.{1,2})?\/[\w.-]+\/|(?:^|[\s("'])[A-Za-z]:\\/],
  ['a file name', /\b[\w-]+\.(?:mp4|mov|m4v|webm|mkv|avi|png|jpe?g|gif|webp|heic|svg|pdf|docx?|xlsx?|pptx?|key|csv|tsv|txt|md|json|ya?ml|xml|js|jsx|ts|tsx|py|rb|go|java|html?|css|zip|wav|mp3|m4a|aac|psd|fig)\b/i],
  ['a web address', /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|dev|app|co|us|uk|de|fr|me|tv|xyz)\b/i],
  ['a long number', /\d{7,}/],
];

export type CardWarnings = Partial<Record<CardField, string[]>>;

export function cardWarnings(card: MomentCard): CardWarnings {
  const out: CardWarnings = {};
  for (const field of CARD_FIELDS) {
    const text = card[field];
    const found: string[] = [];
    if (field === 'whatToDo' && text.trim().length > 0
      && (text.trim().length < WHAT_TO_DO_MIN || text.trim().length > WHAT_TO_DO_MAX)) {
      found.push(`${LEARNING_REFUSAL_PREFIX}: "What to do" needs ${WHAT_TO_DO_MIN}–${WHAT_TO_DO_MAX} characters.`);
    }
    const kinds = [...new Set(TEXT_RULES.filter(([, re]) => re.test(text)).map(([kind]) => kind))];
    if (kinds.length) found.push(`${LEARNING_REFUSAL_PREFIX}: it contains ${kinds.join(', ')}.`);
    if (found.length) out[field] = found;
  }
  return out;
}
