/**
 * lib/training-review-copy.ts — the words the coaching surfaces are allowed to say.
 *
 * SPEC §2.4 (honest privacy copy) and §2.3 (customer-facing simplicity).
 *
 * WHY THE COPY IS A MODULE. Two of these sentences are load-bearing promises about
 * where a customer's screen recording goes. A privacy claim that drifts by one word
 * during a refactor is a product lie, and a regex over JSX cannot tell a reworded
 * promise from a deleted one. Pinning them here lets the tests assert them VERBATIM
 * and lets the mutation harness prove that assertion is load-bearing.
 *
 * REGISTER. Matched to `verified-artifacts.tsx` — "Checked on this Mac by Implexa",
 * and, on failure, "Implexa could not read this file for review just now. That does
 * not mean the file is gone." Plain, and never claiming more than is known. So:
 *
 *   · we never say "nothing is uploaded" — selected evidence IS uploaded, and §2.4
 *     requires us to say exactly that;
 *   · we never say a recording contains no secrets (§2.4: the Coach controls the
 *     captured surface); and
 *   · an unreadable projection says we could not read it, not that it is empty.
 */

/**
 * §2.4, VERBATIM. Do not reword. If the behaviour changes, change the behaviour's
 * description here and let every test that pins it fail loudly.
 */
export const PRIVACY_PROMISE =
  'The full recording stays on this Mac. Only the moments you select, their transcript, '
  + 'and the evidence needed to verify the teaching are saved to your private Agent history.';

/**
 * The honest qualifier. "Only the moments you select" is a real limit, not a claim
 * that nothing leaves the machine, and this line refuses to let a reader round it to
 * the latter.
 */
export const PRIVACY_QUALIFIER =
  'Selected moments do leave this Mac. Implexa cannot tell you whether a recording '
  + 'contains a secret — you choose what is on screen and which moments you keep.';

/** What the Coach is shown before anything is sent (§2.4: previewed before upload). */
export const EVIDENCE_PREVIEW_NOTICE =
  'You see every selected moment before it is saved.';

/** §2.4: private inheritance, never marketplace evidence automatically. */
export const PRIVACY_SCOPE_NOTICE =
  'Selected evidence stays private to you and your organization. It never becomes '
  + 'marketplace evidence on its own.';

/** F0 uploads no recording at all. Said plainly rather than implied. */
export const NO_RECORDING_UPLOAD_NOTICE =
  'Implexa has not uploaded any recording.';

/**
 * The unreadable-projection sentence, in the `verified-artifacts.tsx` register:
 * unavailable is not empty.
 */
export const PROJECTION_UNAVAILABLE =
  'Implexa could not read this training record just now. That does not mean it is gone.';

/** A state Implexa has not been able to read. Distinct from "no". */
export const STATE_UNKNOWN_COPY =
  'Implexa could not read this just now. That does not mean it did not happen.';

/**
 * §1.2 / §3.4: a proposal the recording cannot justify is SHOWN, not hidden. Hiding it
 * would let the Coach believe the recording said something it did not.
 */
export const INSUFFICIENT_EVIDENCE_HEADING = 'Not enough evidence to propose this';
export const INSUFFICIENT_EVIDENCE_BODY =
  'The recording does not show enough to justify this decision. Write what you meant, '
  + 'or discard it. Implexa will not guess.';

/**
 * §1.3 and the F0 must-nots. Nothing in this foundation activates a learning, and the
 * surface has to say so rather than leaving a reader to assume the opposite.
 */
export const INERT_CANDIDATE_HEADING = 'Saved as a candidate — not active';
export const INERT_CANDIDATE_BODY =
  'This changes nothing about future runs. Activating a learning is a separate, '
  + 'explicit step that is not available yet.';

export const ACTIVE_LEARNING_HEADING = 'Active for future runs';
export const ACTIVE_LEARNING_BODY =
  'A later run may select this decision. Manager receipts record when it does.';

/** §2.3: the Coach's five steps, in the Coach's words. No internal machinery. */
export const COACH_STEPS: readonly string[] = [
  'Teach this Agent',
  'Record',
  'Review moments',
  'Apply revision',
  'Save improvement to Agent',
];
