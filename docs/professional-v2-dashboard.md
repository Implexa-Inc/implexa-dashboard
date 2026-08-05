# Professional v2 — the authenticated creator lane

The Dashboard surface for `professional-generation-control.v2`: an explicit
multi-moment B-roll timeline, compiled and priced by the backend, saved under the
signed-in user's own JWT, and approvable only through a gate that no single
condition can be relaxed past.

**Backend contract pin:** `implexa-backend@5cad5203342068981ec9e739792db52379235089`
(migration 0157, `generation-quality.v1` / contract `2026-08-01`).

---

## The two axes, and why every screen keeps them apart

| | what it is | what more of it buys |
| --- | --- | --- |
| **Coverage** | how many **moments** the timeline carries | more finished B-roll |
| **Variants** | how many **takes** are generated for ONE moment | more choice for the same seconds |

Four takes of one 3-second moment is still three seconds of footage. Every
summary states coverage and takes as two separate numbers, and
`coverageSummary()` exists so no component has to phrase that itself. A mutant
that prints the take count where the moment count belongs is killed by a test.

## Cost, in three numbers that are never merged

* **Expected** — what the requested takes spend if nothing is repaired.
* **Repair reserve** — contingent. Priced into the ceiling, released only by a
  Judge verdict, and possibly never spent.
* **Hard maximum** — expected + reserve. This is what an approval authorizes, and
  it is the figure the approval control asks the user to confirm by name.

Before a preview the figures are this build's own arithmetic over the pinned rate
catalog, labelled as an estimate. After a preview they are the backend's compiled
numbers, verbatim. If the two disagree the plan **cannot be approved** — a
disagreement means the plan that was priced is not the plan that was sent, so
neither figure describes what the user is about to authorize.

## Bounds (probed from the producer, never transcribed)

| bound | value |
| --- | --- |
| moments per timeline | 1 – 10 |
| moment duration | 2 – 10 s, millisecond precision |
| variants per moment (Professional) | 1 – 4 |
| repair reserve per moment | 0 – 1, and **only** with Judge `ranked` |
| Judge modes | `off`, `ranked` |
| tasks per approval | ≤ 40 |
| source prompt | ≤ 700 chars, further reduced by the derived suffix |
| aspect ratio | `720:1280` only |
| moment id | `^[a-z0-9][a-z0-9_-]{0,39}$`, unique |
| timeline order | ascending, non-overlapping; **abutting is valid** |

`scripts/regenerate-professional-v2-fixtures.mjs` discovers every one of these by
asking the deployed compiler what it accepts, then writes them into
`lib/professional-v2.fixtures.ts` alongside real preview/create/read wire
documents. `lib/professional-v2-contract.ts` reads them; nothing is typed twice.

```bash
IMPLEXA_BACKEND_DIR=/path/to/implexa-backend npm run fixtures:professional-v2
IMPLEXA_BACKEND_DIR=/path/to/implexa-backend npm run fixtures:professional-v2:check
```

The generator refuses any backend HEAD other than the pin, and refuses to write a
fixture containing a local path, a URL, a bearer token or a JWT.

## The discriminator

`controlContractVersion: "professional-generation-control.v2"` is written into
every v2 request from a pinned constant in the server-side action allowlist. It is
never echoed from the browser body and never inferred from the fact that the
moments carry `judge_mode` or `variants_requested`.

Reading responses, `lib/generation-control-contract.ts` makes the routing decision
once, from one field:

* field genuinely absent (or `undefined`) → **v1**
* exactly `professional-generation-control.v2` → **v2**
* exactly `professional-generation-control.v1` → **v1**
* `null`, `""`, `"  "`, a trimmed or re-cased variant, anything else → **malformed**

A v1 document carrying v2's fields — or the reverse — is refused as mixed identity
rather than parsed as either. Quick/v1 documents then reach
`parseGenerationProposalResponse` **verbatim**: same module, same function, same
bytes, so "v1 behaves exactly as before" is structural rather than promised.

## The approval gate

`decideProfessionalApproval` is the only path to an approve request. Six
independent conditions, any one of which refuses:

1. **Single flight** — a double click sends exactly one request.
2. **The reference survives** — an edit invalidated nothing.
3. **The backend says available and awaiting approval, and it has not expired.**
4. **Proposal identity** — id, version and digest still match what was shown.
5. **Graph identity and timeline fingerprint** — the compiled plan and the
   timeline it was compiled for are both unchanged.
6. **Explicit ceiling confirmation** — the user confirmed the exact hard maximum,
   not the expected spend.

The response is then only believed if it parses under the strict v2 parser, names
this proposal, carries the same proposal and graph digests, reads lifecycle
`approved`, and its authorization ceiling equals the compiled maximum. Anything
else is reported as **unverified** — never as approved and never as "nothing
happened". The idempotency key is minted once per mounted card so a deliberate
retry cannot double-authorize.

## The edit lifecycle

Editing a saved plan is a **durable** transition, not a local one.

* **The plan is carried forward.** Edit navigates to
  `…/generate-broll?from=<proposalId>`; the entry page reads that proposal through
  the same owner-scoped authenticated read, confirms it is a v2 plan **for this
  run**, and seeds the editor with its moments. Editing changes a timeline instead
  of discarding it.
* **The old identity is durably retired.** An approvable plan is **cancelled at
  the backend** before the editor opens, and the editor opens only on a *confirmed*
  cancellation. Forgetting the identity in component state is not invalidation —
  it survives exactly as long as the card is mounted, so a Back press would make
  the abandoned plan approvable again at its old ceiling while the backend still
  held it `awaiting_approval`. Cancelling also removes the window in which two
  approvable plans exist for one run, each with its own ceiling.
* **Nothing is lost.** The moments are already in the editor, so re-compiling and
  re-saving reproduces the plan exactly.
* **No identity travels with the seed** — no proposal id, version, digest or graph
  digest — so a fresh compile is unavoidable before anything can be saved.
* **A plan that was never approvable** (unavailable, expired, already cancelled)
  has nothing to retire and opens directly. An **approved** plan cannot be edited
  at all: the money is committed, and the honest next step is a new plan.
* **A failed retirement does not navigate.** The card says the plan is still
  approvable rather than showing copy about an edit that did not happen.

## Known gap — the source-duration boundary

Nothing on any surface bounds a moment's timestamps to the length of the source
video, so a 30-second run can authorize a moment ten minutes in. It predates this
PR, affects Quick/v1 identically, and cannot be fixed from the Dashboard because
no surface holds the number. Full audit and the deploy-ordered fix:
[`source-duration-boundary-audit.md`](./source-duration-boundary-audit.md).

## Availability today

The three Professional server flags are false, so the backend compiles the plan
and marks it unavailable. The Dashboard shows the plan, names the backend's own
missing capabilities, and offers **no approval control at all** — not a disabled
one. Saving remains possible and produces a row in state `unavailable`, which is
how the preview/create path can be exercised in production without any spend.

---

## Production manual acceptance checklist

Proves the Dashboard/JWT preview and create path end to end. **No approval and no
provider spend.** Every step below is free.

Preconditions: a signed-in account with a run that has a validated final video
artifact (`.mp4/.mov/.m4v/.webm`, role `final_output`).

1. **Signed-out proxy refusal.** In a private window, `POST /api/generation-proposals`
   with `{"action":"preview-professional-v2"}` → **401 `not signed in`**. The
   browser cannot reach the backend without a session.
2. **Open the lane.** Run → *Generate B-roll* → the **Professional** lane.
   Quick is the default and must look and behave exactly as it did.
3. **Editor bounds.** Confirm each of these is refused *before* any request:
   a 1-second window; an 11-second window; an empty description; a description
   over the stated character room; two moments that overlap; a moment dragged
   above one that starts earlier (with *Sort by start time* offered as the fix);
   a repair reserve while Judge is `off`; more than 4 variants (not offerable);
   a plan exceeding 40 generations.
4. **Abutting stays valid.** Two moments where one ends exactly where the next
   begins must compile.
5. **Estimate is labelled.** Before compiling, the summary reads *Estimate — not
   yet compiled* and states expected / reserve / hard maximum separately.
6. **Compile (preview).** Click *Compile plan*. In DevTools → Network:
   * the request goes to `/api/generation-proposals` (same origin) — **not** to
     `core.implexa.ai`;
   * the browser request carries **no** `Authorization` header;
   * the response body's `proposal.control_contract_version` is exactly
     `professional-generation-control.v2`;
   * `proposal_id` is `null` and `state` is `proposed` — a preview is not durable.
7. **Flags are false — observed, not assumed.** The same response must read
   `availability: false` with `required_missing_capabilities` containing all three
   of `server.control_plane_v1`, `server.judge_evidence_v2`,
   `server.segment_projection_v1`. Each entry appears **only** when that flag is
   not exactly `"true"`, so this step is the live confirmation that all three
   remain false.
8. **Honest unavailability.** The page states Professional is unavailable, names
   those capabilities in plain words, and shows **no** approve control.
9. **Compiled figures replace the estimate.** The summary now reads *Compiled by
   Implexa*, and expected + reserve = hard maximum.
10. **Edit invalidates.** Change any prompt, timestamp, variant count, Judge mode
    or reserve — the compiled plan and its cost disappear and *Compile plan*
    returns. Reorder two moments: same result.
11. **Create.** Compile again, then *Save this plan without approving*. The
    response carries `state: "unavailable"`, a real `proposal_id`, and
    `identity.authorization_id: null`. The browser navigates to
    `/generations/<id>`.
12. **The saved plan renders as v2.** The page shows the timeline card (moments,
    windows, per-take prompts, per-moment ceilings), the three cost figures, the
    unavailability notice — and **no approve button and no ceiling checkbox**.
13. **No approval is reachable.** There is no control on the page that issues an
    `approve` action. Confirm in Network that none was sent.
14. **Edit carries the plan and retires the old one.** On the saved plan press
    *Edit this plan*. The builder opens on the **Professional** lane with every
    moment, window, variant count, Judge mode and reserve intact, and states that
    the previous plan was retired. Confirm:
    * the URL carries `?from=<the proposal id>`;
    * no cost figure is shown as compiled — *Compile plan* is required again
      before *Save* reappears;
    * pressing **Back** to the old plan shows it as **cancelled** with no approve
      control. (Today, with the flags false, the plan was `unavailable` and
      therefore never approvable, so no cancellation is issued and the copy says
      so — that is the correct behaviour, not a missing step. The cancel-first
      path is exercised only once the flags are enabled.)
15. **A broken edit link is said out loud.** Hand-edit the URL to
    `?from=<a random UUID>` → the builder starts empty **and** shows the notice
    that the plan could not be loaded. It must never open blank and silent.
16. **Quick is unchanged.** Return to the run, use the Quick lane, compare quality
    modes and create a Quick proposal exactly as before. Its response carries **no**
    `control_contract_version`, and its proposal page renders the original card.
    Visiting `/generate-broll` with no `?from=` still opens on **Quick**.
17. **Nothing leaked.** Across every response inspected: no provider key, no
    signed URL, no local filesystem path, no JWT in any body.

Stop here. Approval and any provider call are out of scope for this lane and are
gated behind enabling the three server flags, which remain false.
