# Audit — the source-duration boundary

**Scope:** does anything, anywhere, bound a B-roll moment's timestamps to the
length of the source video it is cut into?

**Answer: no. Nothing does, on any surface.** The gap is real, it predates this
PR, it affects Quick/v1 identically, and it **cannot be closed from the Dashboard**
because no surface has the number to close it with.

Audited at `implexa-dashboard@820da5e` (this PR's base),
`implexa-backend@5cad5203342068981ec9e739792db52379235089` (the contract pin),
and `implexa-desktop` `feat/professional-v2-execution` (`9fadb0e`).

---

## What the contract actually bounds

`normalizeV2RequestMoments` and `buildProfessionalControlGraphV2` bound a moment's
**duration** (2–10 s), its **precision** (whole milliseconds), its **ordering**
(ascending, non-overlapping) and its **floor** (`start_seconds >= 0`).

There is **no ceiling on `start_seconds` at all.** Probed against the pinned
producer:

| submitted window | verdict |
| --- | --- |
| `0 → 3 s` | ACCEPTED |
| `600 → 603 s` | ACCEPTED |
| `86 400 → 86 403 s` (one day in) | ACCEPTED |
| `1e9 → 1e9+3 s` (~32 years in) | ACCEPTED, `start_ms = 1000000000000` |
| v1 `fast` at `99 999 s` | ACCEPTED |

So a 30-second source run will happily compile — and, with the flags on, price
and authorize — a moment at 09:59:59. Every credit of that authorization buys a
clip that has nowhere to go.

## Why nothing catches it

**Backend.** `brollSourceEligibility` reads `run_artifacts` and checks only that a
`validated` / `final_output` row exists whose `relative_path` ends in
`.mp4|.mov|.m4v|.webm`. It never opens the file and never consults a length.

The schema cannot help it: `run_artifacts` (migration `0126`) stores
`sha256`, `size_bytes`, `mtime`, `validated_path` — and **no media duration
column**. The only `duration_*` columns in the whole schema
(`skill_runs.duration_ms`, `expected_duration_ms`, the orchestration step records)
are run **wall-clock** durations, not media length. `duration_seconds` inside the
control graph is the **clip** length, never a position bound.

**Desktop.** The v2 execution worker never reads `start_ms` or `end_ms` — grepping
`src/` for either returns nothing. It resolves candidates and repairs by
`moment_id`, `task_kind` and ordinal, and generates from the prompt. B-roll
generation is text-to-video: the source file is not an input to the provider at
all, so generation succeeds for any window, valid or not.

**Dashboard.** The entry page selects `status, role, relative_path` from
`run_artifacts` — no duration, because there is none to select. The editor bounds
each window to 2–10 s and to the ordering rules, and has no idea how long the
source is.

## Why this has not bitten yet

The graph declares `assembly: { projection_only: true, final_render_authorized: false }`.
Nothing places clips onto a timeline today, so an out-of-range window is currently
inert metadata. The gap becomes a **paid** defect the moment segmented assembly
lands — which is exactly the capability Production is blocked on
(`video.orchestration.segmented_assembly`).

That timing is the risk: the authorization is minted and charged **now**, under a
contract whose placement semantics arrive **later**. A ceiling added after
assembly ships does not refund the graphs approved before it.

## Why this PR does not fix it

A Dashboard-side clamp would have to invent the bound. The browser has no source
duration, the backend has no column to serve one from, and the artifact row does
not carry it. Guessing — from `size_bytes`, from a default length, from the
largest timestamp the user has already typed — would be precisely the
"never let the browser invent" failure this lane is built to avoid, and would
produce a confidently wrong refusal or a confidently wrong acceptance.

So the boundary is **reported, not patched.** No Dashboard code was changed for
it.

## Recommended fix (backend + desktop, separate PR, deploy-ordered)

1. **Capture the number.** `run-artifact-validation` on the desktop already shells
   out to `ffprobe` (`src/execution/segment-qa-verifier.js`), so probing duration
   at validation time is a small addition to a path that already computes
   `sha256`, `size_bytes` and `mtime`.
2. **Store it.** Add a nullable `media_duration_ms` to `run_artifacts`. Nullable
   matters: every artifact validated before the change has no duration, and those
   runs must keep working.
3. **Enforce it where money is authorized**, in `brollSourceEligibility` /
   `normalizeV2RequestMoments`: reject a moment whose `end_ms` exceeds the source
   duration. Fail **open** only when the duration is unknown (`NULL`), and say so
   — a null must not silently become "unbounded" forever, so it needs a metric or
   a backfill plan, not just a `?? Infinity`.
4. **Then** surface it in the Dashboard: show the source length on the timeline,
   clamp the inputs, and refuse out-of-range windows before submission — reading
   the duration from the backend, never deriving one.

Order matters: steps 1–2 must be deployed and backfilled before step 3 can refuse
anything, and step 4 must not ship before step 3 or the editor would enforce a
bound the backend does not.

## Also worth noting

Because the bound is missing on the **request** path, it is missing for **Quick/v1
too**. Any fix should be applied at `cleanMoments` and `normalizeV2RequestMoments`
together, or Quick becomes the cheaper way to authorize an unplaceable clip.
