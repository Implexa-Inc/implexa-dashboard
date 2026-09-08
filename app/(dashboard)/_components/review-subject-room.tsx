'use client';

/**
 * <ReviewSubjectRoom /> — the typed subject adapter (spec §3.3, F0 item 5).
 *
 * UI REUSE, NOT AUTHORITY CONFLATION. One entry point renders either room; which one
 * is decided by an exhaustive switch on the subject discriminant, and each arm can
 * only be reached with the identities that arm's authority is allowed to write.
 *
 * ── WHY THE DISCRIMINANT IS AT THE TOP OF THE PROPS UNION ────────────────────────
 *
 * The obvious shape is `{ subject: ReviewSubject; run?: …; training?: … }`. It does
 * not work, and the way it fails is instructive: TypeScript does not narrow a parent
 * union from a NESTED discriminant (`props.subject.kind`), so both payloads must be
 * optional — and optional payloads are exactly the "naive optional prop" failure this
 * adapter exists to prevent. The union below is `RunArtifactSubject & { run }` versus
 * `TrainingSourceSubject & { training }`, so:
 *
 *   · `switch (props.kind)` narrows completely;
 *   · inside the training arm `props.runId` DOES NOT EXIST — not "is undefined", does
 *     not exist — so there is no expression that could hand a run id to ReviewRoom; and
 *   · a third subject kind added to `ReviewSubject` makes `assertNever` below fail to
 *     compile, rather than falling through to the run arm.
 *
 * The last point is the one that matters most: the DEFAULT arm cannot silently become
 * run review. That is what "structurally incapable" means here.
 */

import ReviewRoom, { type ReviewRoomProps } from './review-room';
import TrainingReviewRoom, { type TrainingReviewRoomProps } from './training-review-room';
import {
  assertNever, type RunArtifactSubject, type ReviewSubject, type TrainingSourceSubject,
} from '@/lib/review-subject';

/** Everything ReviewRoom needs EXCEPT the identities the subject supplies. */
export type RunReviewArm = Omit<ReviewRoomProps, 'runId' | 'initialArtifactId'>;

/** Everything the training room needs EXCEPT the subject. */
export type TrainingReviewArm = Omit<TrainingReviewRoomProps, 'subject'>;

export type ReviewSubjectRoomProps =
  | (RunArtifactSubject & { readonly run: RunReviewArm })
  | (TrainingSourceSubject & { readonly training: TrainingReviewArm });

/** Recover the plain subject value, for anything that needs the §3.3 shape itself. */
export function subjectOf(props: ReviewSubjectRoomProps): ReviewSubject {
  switch (props.kind) {
    case 'run_artifact':
      return { kind: 'run_artifact', runId: props.runId, artifactId: props.artifactId };
    case 'training_source':
      return { kind: 'training_source', trainingSessionId: props.trainingSessionId, sourceId: props.sourceId };
    default:
      return assertNever(props, 'subjectOf');
  }
}

export default function ReviewSubjectRoom(props: ReviewSubjectRoomProps) {
  switch (props.kind) {
    case 'run_artifact':
      // The ONLY place `<ReviewRoom />` is reached from the adapter, and the ids come
      // from the narrowed run arm — never from a caller-supplied optional prop.
      return <ReviewRoom {...props.run} runId={props.runId} initialArtifactId={props.artifactId} />;

    case 'training_source':
      return (
        <TrainingReviewRoom
          {...props.training}
          subject={{
            kind: 'training_source',
            trainingSessionId: props.trainingSessionId,
            sourceId: props.sourceId,
          }}
        />
      );

    default:
      return assertNever(props, 'ReviewSubjectRoom');
  }
}
