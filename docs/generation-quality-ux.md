# Quality-mode, paid-generation approval, progress, and clip review — UX & contract note

Wave 1 Session B (dashboard-only). Backend contract: **`generation-quality.v1`,
`contract_version 2026-08-01`**, consumed from backend PR #130 at its
post-review head `19fc508` ("fail closed on incomplete generation evidence";
`docs/contracts/generation-proposal-v1.schema.json` + `.examples.json`). Parser
fixtures in `lib/generation-proposal.fixtures.ts` are the backend compiler's
byte-exact output (digests included), verified identical to that commit.

## Modes

| UI label | Backend value | Availability |
|---|---|---|
| Quick | `fast` | Available. "Faster, lower-density generation with essential validation." |
| Professional | `professional` | **Unavailable** (`missing_required_professional_execution_capabilities`): its Judge/repair/assembly pipeline is *described but not enforced*, so it compiles unavailable **with its full task graph retained for preview**. Copy says so — "described in its plan but not genuinely enforced, so its results can't be promised yet." |
| Production | `production` | Unavailable (`missing_required_production_capabilities`), empty graph. "…needs per-clip judging and segmented assembly, which aren't built yet." |

Only the backend **value** is ever persisted or sent. Mode *differences*
(density, pipeline stages, review requirements, credits) are displayed verbatim
from the backend-compiled proposal — the dashboard computes none of them.
Production is disabled behind **two independent gates** (static build flag +
compiled `availability`); deleting either leaves the other (mutation-verified).
An unavailable proposal that carries a task graph renders as a **no-money
preview**: the plan is shown, and no approve/cancel control exists at all.
The parser additionally **pins each mode's contracted shape**: a Professional
document must be exactly unavailable-with-graph under its own reason, and a
Production document exactly the zero-task shape under its own — so a response
claiming "Professional, available" cannot parse at this contract version, no
matter what the rest of it says.

## Proposal card (`awaiting_approval` only)

Shows exactly what the backend compiled: mode, provider/model pins, every clip
with its moment label, timestamp window, exact prompt, duration/ratio, credits
per clip, the maximum total, review requirements, expiry, and the requesting
agent in non-technical copy. **Credits only — this contract supplies no dollar
figure, so none is rendered anywhere.**

- **Approve** — label `Generate 3 B-rolls — up to 180 credits`. Sends proposal
  id + version + digest verbatim with one Idempotency-Key minted per mounted
  card; a double-click sends exactly one request (pure reducer, tested); a
  deliberate retry reuses the same key. Success copy states *authorization*,
  never payment. **The response is never trusted on `ok` alone**: approve and
  cancel run the reply through the same strict parser with the expected
  proposal id and require lifecycle `approved`/`cancelled` respectively
  (`interpretActionResponse`); anything else — malformed 200, foreign identity,
  wrong lifecycle, `unavailable` — renders "couldn't confirm" and re-reads.
- **Edit** — destroys the local approval identity (`editReset`) before
  navigating to the source run; the old payload cannot be approved from an
  edited card. A new proposal/version/digest must come from the backend.
- **Cancel** — only while `awaiting_approval` (the backend's rule).

## Lifecycle / progress states

Distinct copy per state, from the backend's own projection —
`awaiting_approval`, `pending` ("Approved — waiting for your Desktop… nothing
has been generated yet"), `generating` (truthful N-of-M from durable task
events/receipt rows only; zero events renders "no clip events recorded yet",
never `0 of 0`), `completed`, `failed`, **`unknown`** (its own state, not
failed; explicitly instructs *not* to retry and offers no retry control),
`expired`, `cancelled`, `unavailable` (with the translated reason).

A malformed 200, missing required array, unknown state value, identity
mismatch, digest drift, foreign task/receipt row, or contract-bound violation
(>10 tasks, >1200 credits) **fails the parse**, and the page renders "We
couldn't load this proposal" — never empty, never all-clear. `not_found` is a
separate state, shown only on the backend's affirmative `proposal_not_found`.

**`completed` is an evidence claim, not a status flag.** The parser refuses a
completed read unless the whole chain is on record: a digested receipt bound to
the authorization (id + digest), exactly one row per proposal task, every row
`succeeded` with its artifact digest and matching prompt digest, and a
`task_created` + `task_succeeded` event pair per task agreeing with the row on
provider task ids and with each other on the artifact digest. Events admit only
those two contracted types with their type-specific statuses, at most one per
(task, type), successes paired to starts. `cost.total_credits` must equal the
credits of started tasks — the parser re-derives the sum from the events and
refuses understatement and overstatement alike (`incurredCredits`; spend
attaches to a clip *starting*).

## Clip results

One row per receipt task: label, window, status. The join from receipt to file
is the **sha256 digest** against the run's *validated* review-packet artifacts;
an unreadable packet renders a loud "can't be opened here yet" state, never a
quiet artifact-less list. Rows carry no URL and no path; Play/Comment deep-link
into the existing Review Room (`/review/[runId]?artifact=`), which owns the
opaque `implexa-artifact://preview/<token>` protocol, old-desktop
`update_required` degradation, clip-scoped issue anchoring, and clip-switch
state resets. The `?artifact=` id is honored only when the packet contains it.
**Regenerate this clip** renders disabled with the honest reason (the backend
offers no per-clip regeneration yet); it is not simulated.

## Architecture

One strict parser (`lib/generation-proposal.ts`) → one normalized
`GenerationProposalViewModel`; components consume only the VM. Writes go
through `/api/generation-proposals`, an explicit two-action allowlist proxy
(approve/cancel) modeled on `/api/review`; the JWT stays server-side and extra
client fields are never forwarded. Unknown *additive* backend fields are
accepted; unknown *states* fail closed.

## Testing

`npm test` (node:test, no DOM renderer — these are pure lifecycle/parser tests,
not assembled React render tests), `tsc --noEmit`, `next build`. Load-bearing
guards were mutation-tested by hand across both passes (48 mutations; all
killed after four test gaps found by the passes were closed; three
intentionally shadowed defense-in-depth checks — duplicate task ids, receipt
row-count coverage, row↔created-event provider agreement — are documented
in-code per repo convention, each provably subsumed by a tested neighbor).

## Residual gates before calling this live end-to-end

- Backend PR #130 must merge and deploy; this UI has not run against a live
  `/api/v2/generation-proposals` endpoint yet (all parser evidence is from the
  PR's own compiler output and versioned contract, reconciled at head
  `19fc508`).
- ~~Known backend seam~~ resolved at backend `19fc508`: `sanitizeArtifact` now
  falls back to `artifact_sha256`, so every server-validated success projects
  its digest — and the client accordingly requires a digest on every succeeded
  event, not just at the completed claim.
- No surface creates proposals yet (that flow arrives with the producing
  agent/desktop work). `QualityModeSelector` is mounted on the proposal card in
  its honest degenerate form — only the proposal's own compiled mode is
  selectable, the other modes render disabled ("Details appear once this mode is
  compiled…") and Production shows the translated backend reason. Free mode
  *choice* (with per-mode `/preview` compilations) belongs to the future
  creation surface, not to an already-compiled proposal.
- An end-to-end founder smoke through Desktop pickup → clip review should be
  re-run once both PRs land.
