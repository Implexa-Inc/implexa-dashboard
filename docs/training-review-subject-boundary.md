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
| upstream prefix | `/api/v2/review/...` | `/api/v2/agent-coach/...` |
| action names | `ensure_session`, `create_issue`, … | `training_create_review`, `training_add_annotation`, … |
| surface | `review-room.tsx` | `training-review-room.tsx` |

Four properties hold, and each is asserted in both directions:

1. No action name is shared between the two namespaces.
2. `resolveTrainingReviewAction` refuses every run-review action **by name**, and
   `resolveReviewAction` refuses every training action.
3. No path `resolveTrainingReviewAction` can emit falls outside `COACH_BASE`.
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
`coach-decision-cards.tsx`, and no `activate` parameter on `decideTrainingProposal` —
the wire has exactly two decisions, `confirmed` and `discarded`, and
`resolveTrainingReviewAction` pins that vocabulary. Absence, not a disabled button, is
the guarantee.

## `mint_deferred`: a confirmed teaching is not a learning

When the Coach confirms a card, the backend records
`canonicalLinkState: 'mint_deferred'` rather than minting a canonical learning
candidate. **This is deliberate and must not be "fixed" from this side.** Migration
0190 requires `confidence_inputs.source = 'review_learning_evidence'` plus two
supporting evidence rows from real runs; a demonstration has neither. So a confirmed
teaching is **not yet a learning, because no verified accepted revision exists yet**.

The Dashboard renders that honestly and stops there:

- `learningStanding()` returns `confirmed_not_a_learning` for a deferred mint and
  `confirmed_linked_inert` when the card resolved to a candidate the Agent already had
  evidence for — two different standings, two different sentences, neither implying an
  activation, a queue, or a pending one.
- the server's own `inertNote` is preferred over any sentence this repo could write.
- `deriveAuthorityState` reads **activated** from the server's stated `learning` block
  and leaves `requested`, `implemented`, `verified` and `accepted` `unknown` with their
  own wording, because F0 records a teaching and not a revision. Confirming a card does
  **not** move `accepted`: accepting a revised result is a different fact (§1.3).

Do not weaken 0190, and do not introduce a parallel active-learning authority here.
**F1 is where an eligible verified-and-accepted teaching is converted into the canonical
inert candidate** — that conversion is out of scope for F0 in both repositories.

## Privacy copy

`lib/training-review-copy.ts` holds the §2.4 promise verbatim, together with the
qualifier that keeps it honest: selected moments **do** leave the Mac, and Implexa does
not claim a recording contains no secrets. `lib/training-review-copy.test.ts` pins the
sentence against a hard-coded literal — importing the constant it checks would be a
tautology, and the mutation harness caught exactly that.

## Contract seam

**The backend owns this contract; the Dashboard conforms to it.** Three files carry the
upstream shape and no others:

- upstream paths, bodies and headers — `lib/training-review-actions.ts`
- browser transport and typed refusals — `lib/training-review-client.ts`
- the refusal vocabulary, adopted whole — `lib/training-review-refusals.ts`

The eight routes, exactly:

```
POST /api/v2/agent-coach/sessions/:trainingSessionId/demonstrations
POST /api/v2/agent-coach/reviews                       (Idempotency-Key, min 8 chars)
GET  /api/v2/agent-coach/reviews/:reviewSessionId
POST /api/v2/agent-coach/reviews/:reviewSessionId/annotations
POST /api/v2/agent-coach/annotations/:annotationId/evidence
POST /api/v2/agent-coach/reviews/:reviewSessionId/submission
POST /api/v2/agent-coach/submissions/:submissionId/proposals
POST /api/v2/agent-coach/proposals/:proposalId/decision
```

Versions: fixture `implexa.agent-coach-f0.fixture.v1`, projection
`agent-training-review.v1`, review contract `agent-training-review-session.v1`.

`test-fixtures/training-review-f0.v1.json` vendors the backend's generated
`test-fixtures/generated/agent-coach-f0.json` verbatim under `backend`, with this
repo's `$schema` / `provenance` / `upstream` metadata around it.

- `npm run fixtures:training-review:shape` — the vendored file is the contract this repo
  parses against. Answerable alone.
- `npm run fixtures:training-review:check` — re-runs the backend producer with `--check`
  (so a stale backend copy fails) and compares the vendored payload byte-for-byte.
  Needs the producing repo; **skips honestly** with a message when it is not there, and
  never prints a verification it did not make. A commit note that has drifted while the
  payload is identical is a warning, not a failure — the contract claim is the bytes.
- `npm run fixtures:training-review:vendor` — re-copy from the producer.

`lib/training-review-contract.test.ts` grades the emitted route strings, version
literals, `Idempotency-Key` handling, subject shapes and the 66-entry refusal
vocabulary against that fixture, then re-runs the producer when the backend is present.

## Commands

```
npm test                                  # includes every suite below
npm run test:training-review-mutations    # 56 mutants, 14 boundaries
npm run fixtures:training-review:shape
IMPLEXA_BACKEND_DIR=/path/to/implexa-backend npm run fixtures:training-review:check
```
