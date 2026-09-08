# Training Review is not Run Review

Dashboard boundary for Foundation **F0** of
`boardroom/UNIVERSAL_AGENT_COACH_RECORD_REVIEW_SPEC_2026-09-07.md` (§3.3, §3.4, §5).

`ARCHITECTURE.md` lives in the strategy repository, not here; this file is the
Dashboard-side record of the same boundary.

## The problem

`<ReviewRoom />` is run-bound all the way down. `runId` is a required prop, it flows
straight into `reviewAction({ action: 'ensure_session', runId, artifactId })`, into
`create_issue`, `amend_*`, `continue_*`, into `requestPreview(runId, artifactId)` and
into `href={/runs/${runId}}`.

The obvious way to make it "also do training" is to add `trainingSessionId?: string`
and make `runId` optional. That change type-checks — and still writes `run_review_*`
rows for a demonstration, which §3.3 forbids and §8 lists as an explicit non-goal
("No synthetic run created solely to make run-bound Review tables accept training").

## The boundary

The discriminant does not select a prop. It selects a **write path**, and the two are
disjoint from the browser down to the backend route:

| | `run_artifact` | `training_source` |
| --- | --- | --- |
| identity | `runId`, `artifactId` | `trainingSessionId`, `sourceId` |
| dashboard route | `POST /api/review` | `POST /api/training-review` |
| allowlist | `lib/review-actions.ts` | `lib/training-review-actions.ts` |
| upstream prefix | `/api/v2/review/...` | `/api/v2/agents/training/...` |
| action names | `ensure_session`, `create_issue`, … | `ensure_training_session`, `create_training_annotation`, … |
| surface | `review-room.tsx` | `training-review-room.tsx` |

Four properties hold, and each is asserted in both directions:

1. No action name is shared between the two namespaces.
2. `resolveTrainingReviewAction` refuses every run-review action **by name**, and
   `resolveReviewAction` refuses every training action.
3. No path `resolveTrainingReviewAction` can emit falls outside `TRAINING_BASE`.
4. A `training_source` subject has no `runId` field to read — absent, not undefined —
   so there is no expression that could hand one to `ReviewRoom`.

`app/(dashboard)/_components/review-subject-room.tsx` is the single entry point. Its
props union is `RunArtifactSubject & { run }` | `TrainingSourceSubject & { training }`
— the discriminant is at the TOP of the union because TypeScript does not narrow a
parent union from a nested discriminant (`props.subject.kind`), and a nested one would
force both payloads optional, which is the failure mode above. A third `ReviewSubject`
arm makes the `assertNever` default fail to compile rather than falling through to run
review; `lib/review-subject.test.ts` proves that by compiling probes with `tsc`.

## Separate outcomes, never one status (§1.3)

`lib/training-review-lifecycle.ts` models **six independent three-valued facts** —
requested, demonstrated, implemented, verified, accepted, activated — not one enum.
They genuinely disagree: a revision can be verified and not accepted; a decision can be
accepted forever and never activated (the normal F0 resting state); any of them can be
unreadable, which is not "no".

`activationStance` is derived from the **activated** fact alone. Deriving it from
`accepted` is the bug that function exists to prevent.

## Nothing in F0 activates

There is no `activate` action in `lib/coach-decision-cards.ts`, no Activate control in
`coach-decision-cards.tsx`, and no `activate` parameter on
`confirmTrainingDecision` — the resolver pins `activate: false` on the wire. Absence,
not a disabled button, is the guarantee.

## Privacy copy

`lib/training-review-copy.ts` holds the §2.4 promise verbatim, together with the
qualifier that keeps it honest: selected moments **do** leave the Mac, and Implexa does
not claim a recording contains no secrets. `lib/training-review-copy.test.ts` pins the
sentence against a hard-coded literal — importing the constant it checks would be a
tautology, and the mutation harness caught exactly that.

## Contract seam

The backend F0 is being built in parallel and owns the real routes. Two files carry the
assumption and no others:

- upstream paths and bodies — `lib/training-review-actions.ts`
- browser transport — `lib/training-review-client.ts`

`test-fixtures/training-review-f0.v1.json` is the assumed wire text.
`npm run fixtures:training-review:shape` checks it is the contract this repo parses
against; `npm run fixtures:training-review:check` **fails** until the backend producer
exists and `provenance.producedBy` names its commit.

## Commands

```
npm test                                  # includes every suite below
npm run test:training-review-mutations    # 32 mutants, 11 boundaries
npm run fixtures:training-review:shape
npm run fixtures:training-review:check    # expected to fail until the backend lands
```
