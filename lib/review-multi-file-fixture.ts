/**
 * lib/review-multi-file-fixture.ts — the real multi-file review, as data.
 *
 * Shaped after the production Review Room session that failed the 2026-08-07 Wave 2
 * acceptance (session b3c75b54-275b-4560-bd9c-de3591d1b68f, parent run
 * 8eeee8cd-4cb8-4665-8aae-968e63452e15): 12 durable draft issues across three files —
 * Chapter1.mp4 (9), Chapter2-45s-proof.mp4 (2), Chapter3-45s-proof.mp4 (1) — with zero
 * continuation requests bound to the session.
 *
 * It is deliberately hostile in the two ways the production data is:
 *
 *   INTERLEAVED CLOCKS  Chapter3's only issue sits at 00:04, earlier than most of
 *                       Chapter1's. Under the old global timestamp sort it rendered
 *                       near the top of the rail, above Chapter1 issues that precede
 *                       it in the actual edit.
 *   EQUAL TIMESTAMPS    Two Chapter1 issues share 00:12.500 exactly, so "stable"
 *                       cannot be satisfied by luck.
 *
 * PINNED to implexa-backend@b2b39b8d6858c60cb05f1e3c42f0781beb9add14 (migrations 0165
 * and 0166 applied). The submit response shapes at the bottom of this file were read
 * from that commit's `src/routes/review.js`; `review-submit-contract.test.ts` re-reads
 * the backend source at the same SHA and fails if any of it has drifted.
 */

import type { ReviewArtifact, ReviewIssue } from './review.ts';

const RUN_ID = '8eeee8cd-4cb8-4665-8aae-968e63452e15';
const SESSION_ID = 'b3c75b54-275b-4560-bd9c-de3591d1b68f';

/** Distinct, well-formed digests — the rail treats a bad one as stale, not as absent. */
const sha = (seed: string) => seed.repeat(64).slice(0, 64);
const SHA_CH1 = sha('a1b2c3d4');
const SHA_CH2 = sha('e5f60718');
const SHA_CH3 = sha('29304a5b');

export const FIXTURE_RUN_ID = RUN_ID;
export const FIXTURE_SESSION_ID = SESSION_ID;

export const fixtureArtifacts: ReviewArtifact[] = [
  // Deliberately NOT in display order: the rail must impose one, not inherit it.
  {
    id: 'c2000000-0000-4000-8000-000000000002', runId: RUN_ID,
    relativePath: 'Chapter2-45s-proof.mp4', role: 'output', status: 'validated',
    sha256: SHA_CH2, sizeBytes: 8_412_003, mtime: null, validatedAt: '2026-08-07T11:02:00Z',
  },
  {
    id: 'c3000000-0000-4000-8000-000000000003', runId: RUN_ID,
    relativePath: 'Chapter3-45s-proof.mp4', role: 'output', status: 'validated',
    sha256: SHA_CH3, sizeBytes: 8_390_114, mtime: null, validatedAt: '2026-08-07T11:02:00Z',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000001', runId: RUN_ID,
    relativePath: 'Chapter1.mp4', role: 'output', status: 'validated',
    sha256: SHA_CH1, sizeBytes: 12_004_881, mtime: null, validatedAt: '2026-08-07T11:02:00Z',
  },
];

let seq = 0;
function issue(
  artifactId: string, artifactSha256: string, startMs: number, body: string,
  opts: { endMs?: number | null; id?: string } = {},
): ReviewIssue {
  seq += 1;
  return {
    id: opts.id ?? `11111111-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID, runId: RUN_ID, artifactId, kind: 'change',
    anchor: {
      version: 1, type: 'media_time', artifactSha256,
      timeStartMs: startMs, timeEndMs: opts.endMs ?? null,
    },
    body, status: 'draft', submittedRequestId: null,
    createdAt: '2026-08-07T11:1' + (seq % 10) + ':00Z',
  };
}

const CH1 = 'c1000000-0000-4000-8000-000000000001';
const CH2 = 'c2000000-0000-4000-8000-000000000002';
const CH3 = 'c3000000-0000-4000-8000-000000000003';

/**
 * The 12 durable drafts, supplied in an order no consumer may depend on — the array
 * sequence here is neither the creation order nor the render order.
 */
export const fixtureIssues: ReviewIssue[] = [
  // Chapter3 (1) — earliest local timestamp in the whole run, and it must still
  // render LAST, after every Chapter1 and Chapter2 issue.
  issue(CH3, SHA_CH3, 4_000, 'Cold open lands flat — hold the title one beat longer.'),

  // Chapter1 (9), supplied scrambled.
  issue(CH1, SHA_CH1, 40_250, 'Music ducks too late under the voiceover.'),
  issue(CH1, SHA_CH1, 12_500, 'Lower third overlaps the speaker’s chin.', { id: '11111111-0000-4000-8000-0000000000b2' }),
  issue(CH1, SHA_CH1, 3_100, 'Fade in is abrupt; start from black.'),
  issue(CH1, SHA_CH1, 12_500, 'Same beat: the cut is one frame early.', { id: '11111111-0000-4000-8000-0000000000a1' }),
  issue(CH1, SHA_CH1, 27_000, 'B-roll here is unrelated to the claim.', { endMs: 31_500 }),
  issue(CH1, SHA_CH1, 8_750, 'Typo on the card: “recieve”.'),
  issue(CH1, SHA_CH1, 55_900, 'Colour shift between these two shots.'),
  issue(CH1, SHA_CH1, 27_000, 'Point note at the same instant as the range above.'),
  issue(CH1, SHA_CH1, 61_400, 'End card holds too long before the logo.'),

  // Chapter2 (2)
  issue(CH2, SHA_CH2, 21_000, 'Audio clips on the applause.'),
  issue(CH2, SHA_CH2, 6_200, 'Caption timing drifts behind the speaker.'),
];

/** What the rail must print, in order, for this fixture. */
export const EXPECTED_GROUPS: Array<{ displayName: string; count: number }> = [
  { displayName: 'Chapter1.mp4', count: 9 },
  { displayName: 'Chapter2-45s-proof.mp4', count: 2 },
  { displayName: 'Chapter3-45s-proof.mp4', count: 1 },
];

export const EXPECTED_TOTAL = 12;

// ── the pinned submit contract ──────────────────────────────────────────────

/**
 * THE AUTHORITATIVE PRODUCER: deployed backend `main`.
 *
 * Every shape below was read from this commit. It is the pin because it is what is
 * actually serving the endpoint — a dashboard wired to a branch head asserts agreement
 * with code no user can reach, and would keep passing while production drifted.
 */
export const BACKEND_PIN = '8c0f71d6eb611faf9635f14c7bafc767d01bc706';

/**
 * The approved #162 head, kept as an OPTIONAL equivalence check.
 *
 * Not an ancestor of `main`: #162 was merged separately (dba53b7) and main then moved on
 * to the #161 learning ledger, which this head does not carry. The dashboard calls none
 * of that, so the two are expected to agree on everything it does call — and
 * `review-submit-contract.test.ts` asserts exactly that, skipping where the commit is
 * not present rather than failing.
 */
export const REVIEWED_HEAD = 'b2b39b8d6858c60cb05f1e3c42f0781beb9add14';

const REQUEST_ID = 'd41d8cd9-1111-4000-8000-aaaaaaaaaaaa';
const SUBMISSION_ID = 'e5f60718-2222-4000-8000-bbbbbbbbbbbb';
const DIGEST = 'c'.repeat(64);

/** The `_publicSession` projection, as the submit route returns it. */
const submittedSession = {
  id: SESSION_ID,
  runId: RUN_ID,
  selectedArtifactId: CH1,
  state: 'submitted',
  submittedRequestId: REQUEST_ID,
  submittedIssueIds: fixtureIssues.map((i) => i.id),
  compiledBrief: 'Review of 3 files…',
  createdAt: '2026-08-07T11:00:00Z',
  submittedAt: '2026-08-08T20:41:00Z',
  acceptedAt: null,
};

/**
 * Every response shape `POST /api/v2/review/sessions/:id/submit` can produce at the
 * pin. Read from the route, not from a description of it — note in particular that
 * `idempotent` carries NO `issueCount`.
 */
export const submitFixture = {
  fresh: {
    ok: true,
    requestId: REQUEST_ID,
    issueCount: EXPECTED_TOTAL,
    brief: 'Review of 3 files…',
    submissionId: SUBMISSION_ID,
    submissionDigest: DIGEST,
    session: submittedSession,
  },
  // `_adoptExistingContinuation`: a crashed attempt's continuation, finalized.
  recovered: {
    ok: true,
    recovered: true,
    requestId: REQUEST_ID,
    issueCount: EXPECTED_TOTAL,
    brief: 'Review of 3 files…',
    submissionId: SUBMISSION_ID,
    submissionDigest: DIGEST,
    session: submittedSession,
  },
  // `prepared.alreadySubmitted`: requestId + session only.
  idempotent: {
    ok: true,
    idempotent: true,
    requestId: REQUEST_ID,
    session: submittedSession,
  },
  refusals: {
    digestMismatch: {
      ok: false, conflict: true, digestMismatch: true,
      error: 'the review changed since this submission was first attempted; the review is back in draft — submit it again',
    },
    requestCancelled: {
      ok: false, conflict: true, requestCancelled: true,
      error: 'the continuation for this review was cancelled before it could be delivered; the review is back in draft — submit it again',
      session: { ...submittedSession, state: 'draft', submittedRequestId: null, submittedIssueIds: null },
    },
    incompleteMapping: {
      ok: false, incompleteMapping: true,
      error: 'an issue references an artifact that is not available on this run; reload the review before submitting',
    },
    noteTooLong: {
      ok: false,
      error: 'revisionNote must be at most 2000 characters',
    },
    unavailable: {
      ok: false, unavailable: true,
      error: 'the artifacts this review refers to could not be read; try again',
    },
  },
} as const;
