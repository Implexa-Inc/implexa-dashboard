/**
 * lib/training-review-client.ts — the ONLY module in the browser that talks to the
 * training-review API.
 *
 * SPEC §5 F0 items 5, 6, 8. Contract seam for the parallel backend F0.
 *
 * ── WHY EVERYTHING FUNNELS THROUGH ONE MODULE ────────────────────────────────────
 *
 * The backend F0 is being built at the same time and owns the real routes and payload
 * shapes. Two files carry the assumption, and no others:
 *
 *   · UPSTREAM BACKEND PATHS + BODIES  `lib/training-review-actions.ts`
 *   · BROWSER TRANSPORT                this file
 *
 * No component may call `fetch` for training review. Every write goes through
 * `sealWrite`, so every request carries its authority and its training identity, and
 * a component holding a `TrainingReviewWritePath` has no expression available to it
 * that would produce a run-review write (see `lib/review-subject.ts`).
 *
 * ── INJECTABLE TRANSPORT ─────────────────────────────────────────────────────────
 *
 * The caller may supply the transport, so every branch here — including every refusal
 * and every unreadable response — is executable in a test against local fixtures with
 * no network and no server.
 */

import {
  sealWrite,
  type TrainingReviewAction, type TrainingReviewWrite, type TrainingReviewWritePath,
} from './review-subject.ts';
import { TRAINING_CONTRACT_VERSION } from './training-review-actions.ts';
import {
  parseTrainingProjection, type TrainingProjectionStatus,
} from './training-review-projection.ts';

/** The dashboard route. The backend paths live in `training-review-actions.ts`. */
export const TRAINING_REVIEW_ROUTE = '/api/training-review';

export type TrainingTransport = (
  route: string, body: Record<string, unknown>,
) => Promise<{ status: number; body: Record<string, unknown> }>;

/**
 * The default transport. Mirrors `reviewAction` in `review-room.tsx`: an unreadable
 * body becomes a refusal object rather than a thrown parse error, so the caller
 * always has something to show.
 */
export const fetchTransport: TrainingTransport = async (route, body) => {
  const res = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({ ok: false, error: 'Unreadable response.' }));
  return { status: res.status, body: parsed as Record<string, unknown> };
};

export type TrainingResult<T> =
  | { readonly ok: true; readonly value: T }
  /**
   * A refusal the Coach can read. `unavailable` distinguishes "we could not reach the
   * service" from "the service said no" — the same three-valued discipline
   * `lib/review.ts` keeps for reads, because they need different words and different
   * buttons.
   */
  | { readonly ok: false; readonly error: string; readonly unavailable: boolean };

const refusal = (error: string, unavailable = false): TrainingResult<never> =>
  ({ ok: false, error, unavailable });

async function send(
  path: TrainingReviewWritePath,
  action: TrainingReviewAction,
  fields: Record<string, unknown>,
  transport: TrainingTransport,
): Promise<TrainingResult<Record<string, unknown>>> {
  const envelope: TrainingReviewWrite = sealWrite(path, action, fields);
  let response: { status: number; body: Record<string, unknown> };
  try {
    response = await transport(envelope.route, { action: envelope.action, ...envelope.payload });
  } catch {
    return refusal('Could not reach the training review service. Nothing was changed.', true);
  }
  const body = response.body ?? {};
  if (response.status >= 200 && response.status < 300 && body.ok === true) {
    return { ok: true, value: body };
  }
  const error = typeof body.error === 'string' && body.error.trim()
    ? body.error.trim()
    : 'The training review service refused that. Nothing was changed.';
  return refusal(error, response.status >= 500 || body.unavailable === true);
}

// ── Writes ────────────────────────────────────────────────────────────────────────

export type EnsureTrainingSession = { reviewSessionId: string; recordingDigest: string | null };

export async function ensureTrainingReviewSession(
  path: TrainingReviewWritePath, transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<EnsureTrainingSession>> {
  const result = await send(path, 'ensure_training_session', {}, transport);
  if (!result.ok) return result;
  const reviewSessionId = typeof result.value.reviewSessionId === 'string' ? result.value.reviewSessionId : null;
  if (!reviewSessionId) return refusal('The training review service did not name a review session.');
  const digest = typeof result.value.recordingDigest === 'string' ? result.value.recordingDigest : null;
  return { ok: true, value: { reviewSessionId, recordingDigest: digest } };
}

export async function createTrainingAnnotation(
  path: TrainingReviewWritePath,
  input: {
    reviewSessionId: string;
    temporalRange: { startMs: number; endMs: number | null };
    coachText: string;
    anchorDigest: string;
    spatialRegion?: unknown;
    transcriptSpan?: unknown;
  },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<{ annotationId: string }>> {
  const result = await send(path, 'create_training_annotation', { ...input }, transport);
  if (!result.ok) return result;
  const annotationId = typeof result.value.annotationId === 'string' ? result.value.annotationId : null;
  return annotationId
    ? { ok: true, value: { annotationId } }
    : refusal('The training review service did not name the moment it saved.');
}

export async function amendTrainingAnnotation(
  path: TrainingReviewWritePath,
  input: { annotationId: string; coachText: string; temporalRange?: { startMs: number; endMs: number | null } },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<{ annotationId: string }>> {
  const result = await send(path, 'amend_training_annotation', { ...input }, transport);
  if (!result.ok) return result;
  // APPEND-ONLY: the server mints a SUCCESSOR id. Reusing the id we sent would make
  // the surface show an edit as though the original row had changed.
  const annotationId = typeof result.value.annotationId === 'string' ? result.value.annotationId : null;
  return annotationId
    ? { ok: true, value: { annotationId } }
    : refusal('The training review service did not name the amended moment.');
}

export async function discardTrainingAnnotation(
  path: TrainingReviewWritePath, annotationId: string, transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<Record<string, unknown>>> {
  return send(path, 'discard_training_annotation', { annotationId }, transport);
}

export async function attachTrainingEvidence(
  path: TrainingReviewWritePath,
  input: {
    annotationId: string;
    kind: 'clip' | 'frame' | 'transcript';
    mediaSha256: string;
    temporalRange: { startMs: number; endMs: number | null };
  },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<{ evidenceId: string }>> {
  const result = await send(path, 'attach_training_evidence', { ...input }, transport);
  if (!result.ok) return result;
  const evidenceId = typeof result.value.evidenceId === 'string' ? result.value.evidenceId : null;
  return evidenceId
    ? { ok: true, value: { evidenceId } }
    : refusal('The training review service did not name the evidence it recorded.');
}

export type TrainingSubmissionResult = {
  submissionId: string;
  submissionDigest: string | null;
  idempotent: boolean;
};

export async function submitTrainingAnnotations(
  path: TrainingReviewWritePath,
  input: { reviewSessionId: string; annotationIds: readonly string[]; recordingDigest: string },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<TrainingSubmissionResult>> {
  const result = await send(path, 'submit_training_annotations', {
    reviewSessionId: input.reviewSessionId,
    annotationIds: [...input.annotationIds],
    recordingDigest: input.recordingDigest,
  }, transport);
  if (!result.ok) return result;
  const submissionId = typeof result.value.submissionId === 'string' ? result.value.submissionId : null;
  if (!submissionId) return refusal('The training review service did not name the submission it froze.');
  return {
    ok: true,
    value: {
      submissionId,
      submissionDigest: typeof result.value.submissionDigest === 'string' ? result.value.submissionDigest : null,
      idempotent: result.value.idempotent === true,
    },
  };
}

/**
 * Confirm one proposed decision.
 *
 * `activate` is NOT a parameter. F0 must not activate a learning, and the way to
 * guarantee that from the client is to have no expression that could ask for it — the
 * resolver pins `activate: false` on the wire, and nothing here can override it.
 */
export async function confirmTrainingDecision(
  path: TrainingReviewWritePath,
  input: {
    submissionId: string;
    decisionId: string;
    disposition: 'accepted' | 'edited' | 'merged' | 'discarded';
    mergedIntoDecisionId?: string;
    edits?: unknown;
  },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<{ candidateId: string | null }>> {
  const result = await send(path, 'confirm_training_decision', { ...input }, transport);
  if (!result.ok) return result;
  // The canonical learning candidate the server minted or linked. INERT by contract;
  // the client never asks for and never receives an activation.
  const candidateId = typeof result.value.candidateId === 'string' ? result.value.candidateId : null;
  return { ok: true, value: { candidateId } };
}

// ── Read ──────────────────────────────────────────────────────────────────────────

/**
 * The read-only projection (F0 item 8).
 *
 * Returns a STATUS, never null: an unreachable service is `live: false` with a
 * reason, so the surface can say it could not read the record instead of rendering an
 * empty one.
 */
export async function readTrainingProjection(
  path: TrainingReviewWritePath, transport: TrainingTransport = fetchTransport,
): Promise<TrainingProjectionStatus> {
  const envelope = sealWrite(path, 'read_training_projection', {});
  try {
    const response = await transport(envelope.route, { action: envelope.action, ...envelope.payload });
    return parseTrainingProjection(response.body, TRAINING_CONTRACT_VERSION);
  } catch {
    return { live: false, reason: 'unreachable' };
  }
}
