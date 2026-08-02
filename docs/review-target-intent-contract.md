# Review issues have no typed target intent — audit and required contract change

**Status:** limitation, not a bug. Recorded here so the dashboard does not invent a
structured field that carries nothing.

**Audited:** 2026-08-02, against `implexa-backend` `origin/main`.

## The question

The Review Room wants to distinguish two intents a reviewer routinely has about a
source artifact:

* **change this file** — edit it in place, this is the thing that is wrong;
* **reference only** — read it, use it, but do not modify it.

Does the existing issue/anchor contract already carry that distinction, so the
dashboard can expose it as an explicit choice and persist it?

## The answer: no, and it cannot be added from the client

Four separate places would all have to change. None of them can be worked around from
the dashboard.

### 1. The anchor validator silently DROPS unknown keys

`src/lib/review-anchor.js` normalizes by rebuilding the object from a fixed literal —
`raw` is never spread:

```js
const base = { version: ANCHOR_VERSION, type, artifactSha256: sha };
if (type === 'artifact') return { ok: true, anchor: base };
```

Its own test pins the behaviour:

> `unknown keys are dropped, so an invented field never becomes stored contract`

So `anchor: { …, intent: 'reference_only' }` returns **HTTP 200 with `intent` gone**.
That is the worst possible shape for a client: no rejection to feature-detect on, and
no persistence. A dashboard that showed a "Reference only" toggle on top of this would
be showing a control that does nothing, and the reviewer would reasonably believe the
agent had been told.

Accepted anchor types are exactly `media_time`, `text_selection`, `pdf_text`,
`artifact`, each with a closed field set.

### 2. There is no column, and no spare RPC parameter

`run_review_issues` (migration `0140_review_room.sql`) has: `id`, `session_id`,
`user_id`, `run_id`, `artifact_id`, `kind`, `anchor`, `body`, `status`,
`submitted_request_id`, timestamps. No `intent`, `target`, `mode`, or `reference`.

`kind` is `CHECK (kind IN ('timing','content','visual','audio','missing','replacement','other'))`
— a taxonomy of *what is wrong*, not *what to do with the file*. `replacement` is the
nearest neighbour and the brief compiler treats it identically to every other kind.

Writes go through `SECURITY DEFINER` RPCs (`review_create_issue`,
`review_update_issue`) with fixed column and `COALESCE` lists.

### 3. Route and service enumerate fields explicitly

`POST /api/v2/review/sessions/:id/issues` forwards exactly `artifactId`, `kind`,
`anchor`, `body`. `PATCH /api/v2/review/issues/:id` forwards exactly `kind`, `anchor`,
`body`. Neither spreads the request body, so nothing extra reaches the service.

### 4. The compiled brief has nowhere to say it — and loses the file, too

`src/lib/review-brief.js` renders each issue as `[n] KIND<location>` followed by the
body. It prints **one** artifact path, once, at the top: the session's
`selected_artifact_id`. Per-issue artifact paths are never printed, even though
`run_review_issues.artifact_id` stores them per row.

**This is a second, independent limitation, and it bites today.** In a multi-artifact
review, the brief names one file while carrying issues about several. The agent cannot
tell which issue belongs to which file. The dashboard now shows `Feedback applies to:
<path>` in the composer — that is honest about what the reviewer is doing, but the
reviewer should know it does not currently survive into the brief.

`artifact.role` is not a substitute for either gap. It is per-artifact and
agent-declared, and `0126_run_artifacts.sql` states it is *"informational only — never
used for access control or trust decisions"*. Overloading it into "read-only" would
violate a stated invariant.

## What the dashboard does instead

Nothing structured, and — since review — nothing canned either. When a draft's frozen
artifact has `role === 'source'`, the composer states the situation and names the file:

> This is a source file. Feedback added here applies to `src/raw-take.mov`. If it is
> only a reference, say so in your own words and name the file you want changed — the
> revision request does not yet label each comment with its own file, so "this section"
> can arrive under a different one.

**A one-click "Use this section as reference; do not modify the source file." was
built and then removed.** It is unsafe for exactly the reason in §4: the brief prints
one artifact path, so that sentence can arrive under a heading naming a different file.
A confident sentence in the wrong context is worse than no sentence, because the
reviewer believes they were unambiguous. Until per-issue paths exist, the only honest
advice is "name the files yourself", and the guidance says so instead of handing over
wording that reads as sufficient.

Intent is never inferred from the text, and no control claims it was recorded.

## The follow-up contract change

Superseded in shape by
`boardroom/REVIEW_ROOM_SPATIAL_FEEDBACK_SPEC_2026-08-02.md` §7, which defines target
intent as part of `review_anchor.v2` rather than as a standalone flag. Three
corrections to the sketch that was here before, all from review:

1. **`change | reference` alone is not enough.** Reference mode must identify the
   actual target: `intent.mode = 'reference_for_artifact'` carries
   `targetArtifactId` **and** `targetArtifactSha256`. "This is only a reference" without
   naming what to change instead is the same ambiguity one level up.
2. **Do not store the intent twice.** Putting it both inside the anchor and in a
   separate `run_review_issues` column, with no database-enforced invariant tying them
   together, creates two sources of truth that can disagree — and the disagreement
   would decide whether a source file gets overwritten. The spec keeps it in the
   anchor; `artifact_id` stays the *observed* artifact.
3. **Fail closed on unknown modes.** An unrecognized `intent.mode` must be rejected,
   never coerced to "change" — the coercion direction here is the destructive one.

Order of work:

1. `review-anchor.js` — v2 validation with the §7.3 invariants: a reference anchor
   *requires* target id + digest, a change anchor *forbids* them, both must resolve to
   artifacts in the run or permitted lineage, and unknown versions/modes fail closed.
2. Migration + RPC parameters, only to the extent the anchor cannot carry it.
3. `routes/review.js` + `run-review.service.js` — forward the v2 anchor on POST/PATCH.
4. `review-brief.js` — group instructions by **target** artifact, print each issue's
   own observed and target identity with digests, and emit the explicit "do not modify
   this reference" line.

**Item 4's per-issue path is worth doing on its own, first, and independently of any
intent field.** It is what makes the dashboard's `Feedback applies to:` line survive
into the brief, and it is the precondition for re-introducing any reference-only
wording helper. Only once (1)–(3) exist should the dashboard offer an explicit
"Change this file / Reference only" choice with a target picker. Until then the choice
would be a lie told with a radio button.
