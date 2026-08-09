# Recovering the stranded Review Room draft

**Status: not yet performed.** This procedure is written to be run *after* the Dashboard
change ships. Nothing in the implementation touched the session it describes, and the
acceptance below is the first time it will be submitted.

## The session

| | |
|---|---|
| Review session | `b3c75b54-275b-4560-bd9c-de3591d1b68f` |
| Parent run | `8eeee8cd-4cb8-4665-8aae-968e63452e15` |
| State | `draft` |
| Durable issues | 12 |
| `Chapter1.mp4` | 9 |
| `Chapter2-45s-proof.mp4` | 2 |
| `Chapter3-45s-proof.mp4` | 1 |
| Continuation requests bound to it | 0 |

Backend pin: `implexa-backend@8c0f71d6eb611faf9635f14c7bafc767d01bc706`, migrations 0165
and 0166 applied, PostgREST schema reloaded.

**This is a handoff failure, not data loss.** All twelve issues are durable and correct.
What never happened is the structured submission and the continuation binding — the
2026-08-07 acceptance created neither, and the run that followed went looking for the
review through Computer Use.

## What must not happen

These are the ways a "recovery" would destroy the thing it was recovering:

- **Do not create another review session.** The issues belong to this one; a new session
  starts empty and orphans them.
- **Do not ask the reviewer to re-enter feedback.** The twelve issues exist, with their
  own IDs, artifact bindings, digests and timestamps.
- **Do not replace issue IDs.** They are the identity the resolution report maps back to.
- **Do not mark the session submitted by hand.** `state = 'submitted'` without a bound
  continuation is precisely the lie this whole epic exists to remove.
- **Do not bind an unrelated continuation that shares the parent run.** The binding is
  per review session (`origin_review_session_id`), not per run.
- **Do not run any of this during implementation or review.** The first submission is the
  acceptance itself.

## Why no migration or backfill is needed

The backend at the pin already treats this exact state as its normal starting point.
`POST /api/v2/review/sessions/:id/submit` calls `review_prepare_submission`, which
snapshots the session's existing issue rows under a row lock and flips `draft →
submitting`. It reads the issues that are already there. A stranded draft with zero
continuations is not a special case — it is the ordinary pre-submission state.

So recovery is *the owner opening the room and pressing the button once*. Everything the
Dashboard change did is in service of that press being honest.

## Procedure

Run as the **owner** of the session, signed in to the dashboard. No service-role
credential is involved at any point; the browser never holds a token.

### 1. Confirm the pre-state (read-only)

Open `/review/8eeee8cd-4cb8-4665-8aae-968e63452e15` and verify, without clicking
anything:

- the rail shows **12** issues total;
- three sticky file headers in this order, with these counts:
  `Chapter1.mp4 — 9 issues`, `Chapter2-45s-proof.mp4 — 2 issues`,
  `Chapter3-45s-proof.mp4 — 1 issue`;
- timestamps ascend **within** each file, and do not interleave across files;
- the primary action reads exactly **`Send 12 changes & start revision`**;
- no "Approve next action", no "Continue work", no "Generate B-roll".

If the count is not 12, **stop** and re-check the session id. A different count means a
different session, or a draft written since this document.

### 2. Optionally add a revision note

The composer above the action is `revisionNote` on the wire — trimmed, and bounded at
2000 characters, by both the client and the server. It **supplements** the twelve
structured issues; it never replaces them.

### 3. Press the button once

One click freezes the count, sends, and settles. Do not click twice — though a double
click is harmless: a synchronous latch stops the second, and the endpoint is idempotent
on `origin_review_session_id` besides.

### 4. Confirm the post-state

The room must show, from the server's own response and not from a refreshed prop:

- `12 changes were sent as one revision.`
- a **Continuation** id (`requestId`);
- a **Submission** id (`submissionId`, the 0165 structured submission);
- no send control at all.

Then verify durably — reload the page. The queued state must survive the reload, read
from the session row rather than from this tab's memory.

### 5. Verify the handoff, server-side

```sql
-- exactly ONE continuation, bound to THIS session, carrying the structured submission
select id, kind, status, origin_review_session_id,
       review_submission_id, review_submission_digest
  from run_requests
 where origin_review_session_id = 'b3c75b54-275b-4560-bd9c-de3591d1b68f';

-- the session now names that request, and the same twelve issue ids
select state, submitted_request_id, cardinality(submitted_issue_ids) as n
  from run_review_sessions
 where id = 'b3c75b54-275b-4560-bd9c-de3591d1b68f';

-- every original issue id is bound, and none was replaced
select id, artifact_id, status, submitted_request_id
  from run_review_issues
 where session_id = 'b3c75b54-275b-4560-bd9c-de3591d1b68f'
 order by artifact_id, id;
```

Pass conditions:

- exactly **one** row in `run_requests`, `status` not `cancelled`;
- `review_submission_id` and `review_submission_digest` both non-null;
- `submitted_request_id` on the session equals that request's id;
- `cardinality(submitted_issue_ids) = 12`;
- all twelve issue IDs are the **same IDs that were there before** — captured in step 1;
- the revision note, if one was entered, is stored on the submission byte-identically to
  what was typed after trimming.

### 6. If it refuses

A refusal is a safe outcome. Every failure path at the pin releases the session back to
`draft` with all twelve issues intact, and the room re-offers the same action.

| What the room says | What happened | What to do |
|---|---|---|
| `…the review changed since this submission was first attempted…` | Digest mismatch: a conflicting replay | Reload and submit again; the recompile is deterministic |
| `…cancelled before it could be delivered…` | A continuation existed and was cancelled | Session is back in draft; submit again |
| `…could not be read; try again` | A read the backend could not make (503) | Retry; nothing was sent |
| `…without naming a revision` | `ok` with no continuation id | **Do not retry blindly.** Check `run_requests` first — this shape should not occur at the pin |
| `We could not reach the review service` | The request never completed | Retry; nothing was sent |

In every case: the twelve drafts and the note are still there. Confirm the count is
still 12 before retrying.

## After a successful recovery

The continuation is created but **not started** by this procedure. Starting it, claiming
it, and running the revision are separate, deliberate actions outside this document.
