# Dashboard audit: re-centering app.implexa.ai on WORKFLOWS

Audit date: 2026-06-03. Scope: the full Next.js dashboard in this repo (`app/(dashboard)/*`, `app/*` auth/onboarding surfaces, `components/*`, `lib/*`). Lens: the new positioning, "Let AI run your business," where the dashboard is mission control for the user's autopilot. Workflows are the lead product; skills are the ingredients.

---

## 1. Executive summary

The dashboard was built skills-first and still is, almost everywhere except the new `/overview` page. The product's own vocabulary has already moved on ("routines," "autopilot," "workflows," "outcomes" live in `/overview`, the watchdog email, and the backend MCP tool surface), but the rest of the IA, the default landing, the nav order, and most page copy still treat the **skill library as the home and the hero**.

The single biggest gap: **there is no first-class WORKFLOWS view anywhere in the dashboard.** A repo-wide search finds the word "workflow" only as incidental copy in 13 files; there is no `/workflows` route, no workflow entity page, no per-workflow steps/verify-gate/outcome view. The closest the dashboard gets is:

- `/overview` links **out** to the marketing site (`${SITE_URL}/workflows`) rather than to an in-app view.
- `/skills/[slug]` already renders `inputs`, `decision_points`, `output_contract`, and `outcome_signal` (the raw material of a workflow: ordered steps, a verify gate, an outcome prior) but frames all of it as a single "skill."
- `skill_runs.source` already has an `'orchestration'` value rendered as a `chain` badge, and `skill_runs.orchestration_id` exists, so multi-step chains already run, but they have no home.

Meanwhile the backend MCP surface (visible in this session) already exposes a first-class workflow model the dashboard reads none of: `list_workflows`, `get_workflow`, `apply_workflow`, `generate_workflow`, `propose_workflow_revision`, `record_workflow_outcome`, and crucially `get_routine_health`. The dashboard today reads only the four RLS-readable tables (`scheduled_skills`, `skill_runs`, `recommendation_events`, `org_skills` / `user_skill_installs`). The redo is therefore mostly a **surfacing + reframing** job, not a from-scratch build.

Second gap: **remote-safety is talked about but never shown.** Copy on `/overview` and in the schedule-row tooltip says "move it to a remote routine," but no surface actually derives or displays whether a given routine is remote-safe or local-only (browser/Chrome-MCP step present). The capability-aware watchdog is a stated differentiator and is currently invisible in the UI.

---

## 2. Data model and platform notes (constraints the redo must respect)

- **RLS:** anon/authenticated cannot read `aggregated_skills` or catalog workflows. The dashboard reads the caller's own `scheduled_skills`, `skill_runs`, `recommendation_events`, plus `org_skills` / `user_skill_installs` within scope. A Workflows view that needs catalog data must go through a backend endpoint or the backend MCP tools, not a raw client read.
- **`darkMode: 'media'`** (`tailwind.config.ts`). The `ink-*` scale flips automatically via CSS vars in `globals.css`. Raw Tailwind color literals (`amber-400`, `emerald-400`, `brand-50`, etc.) do **not** flip and must be paired with `dark:` variants, or they break in one mode. Several status badges and the `brand-50` card backgrounds violate this (see section 6).
- **Backend already has the concepts** (MCP tools present this session): `list_workflows`, `get_workflow`, `record_workflow_outcome`, `get_routine_health`, `detect_recurring_work`, `propose_workflow_revision`. Treat the redo as wiring the dashboard to a model that already exists.
- **No em-dashes** anywhere (already a house rule; one earlier commit, `81c6b8f`, removed an em-dash).

---

## 3. Tab / page / feature inventory and verdicts

Verdict key: **KEEP** (aligned, leave it), **REFRAME** (right surface, wrong framing/copy/position), **NET-NEW** (missing, must build).

### 3a. Primary navigation (`app/(dashboard)/_components/sidebar.tsx`)

Original order: `Overview, Skills, Scheduled, Runs, Integrations, ROI, Leaderboard, Connect Claude`, then `Settings, Pricing`, then conditional `Admin`.

| Item | Current | Verdict | Notes |
|---|---|---|---|
| Brand logo link | `<Link href="/skills">` (desktop and mobile) | **REFRAME** | Logo pointed at the ingredient shelf, not mission control. The root route `app/page.tsx` already sends authed users to `/overview`; the logo contradicted it. (Fixed, see section 7.) |
| Nav order | Skills sat 2nd, directly under Overview, above Scheduled/Runs | **REFRAME** | Order implied "Skills is home." The autopilot loop (Routines, Runs) was buried below the shelf. (Reordered, see section 7.) |
| "Scheduled" label | `label: 'Scheduled'` | **REFRAME** | Everything else in the product says "routines" (`/overview` copy "active routines," the watchdog, `schedule-row` tooltip). The nav was the odd one out. (Relabeled to "Routines," see section 7.) |
| "ROI" label | `label: 'ROI'` | **REFRAME** | The vision names this surface "OUTCOMES" (the success color is documented as "OUTCOMES"). Recommend renaming to "Outcomes" once the page H1 is reframed too (left as "ROI" for now to avoid a nav/H1 mismatch). |
| Setup chip | `SetupChip` (active/idle/stale/never) | **KEEP** | Genuinely useful autopilot-health signal; `never` is a CTA to `/install`. |
| Leaderboard, Integrations, Connect Claude, Settings, Pricing | as-is | **KEEP** (position aside) | Fine as secondary destinations. |

### 3b. Pages and sections

| Surface | Current H1 / key copy (verbatim) | Verdict | Why |
|---|---|---|---|
| `/overview` | "Mission control" / "What your Implexa autopilot is doing for you. Routines run, deliver, and improve on their own." Stat cards: Active routines, Need attention, Runs this week, Last run. "Needs attention," "Recent runs," "Skills implexa noticed." | **KEEP** (the model) | This is the intended direction and the only fully workflow-first page. Minor: "Need attention" lumps overdue + failed but never says **why** (no remote-safe vs local-only signal); the "move it to a remote routine" line is generic. The "Skills implexa noticed" section already carefully distinguishes skills (ingredients) from workflows (the lead) and links out to `/workflows` on the marketing site, proving the intended hierarchy. |
| `/skills` | "Your skills" / "Your library. Fork, run, capture, share, every skill runs in your Claude." 4 tabs: Your skills, Org-wide skills, Trending Globally, Implexa Base Skills. First-time card: "Get started in 30 seconds." | **REFRAME** | This was the de facto home and the hero. It should become the **ingredient shelf**: keep the library, demote it below the autopilot surfaces, and reframe the copy so skills read as components workflows are built from. The 4-tab taxonomy (yours/org/trending/base) is good library IA and worth keeping inside the shelf. |
| `/skills/[slug]` | "SKILL.md content," plus structured cards: "Inputs," "Output contract," "Decision points," "Outcome signal." Stat strip: Used, Unique users, Outcomes, Value. | **REFRAME / promote to workflow detail** | This page **already renders the anatomy of a workflow** (ordered inputs, a verify/quality gate via `output_contract.qualityChecks`, an `outcome_signal` prior, `decision_points`). It is the strongest existing foundation for a per-workflow detail page. Reframe: when the entity is a workflow, render its **ordered steps**, a **capability/remote verdict**, its **run history**, and its **outcomes**, reusing these exact sections. |
| `/scheduled` | Was "Scheduled skills" / "Recurring runs registered via /implexa:schedule." Per-row: status badge, `overdue` badge (`looksOverdue`), destination label, `run_count`, last run, publish target. Pause/Resume/Delete via direct RLS writes. | **REFRAME** | This IS the autopilot and should be framed as such. The row already has most of what matters. Missing: a **remote-safe vs local-only** chip per routine, and the link to the **workflow** a routine runs. (H1 reframed to "Routines," see section 7.) |
| `/runs` | "Runs" / "Output log for scheduled + orchestrated skill runs. Latest 50 across all sources." Per-row: status badge (ok/partial/failed), source badge (scheduled/chain/ad-hoc), delivery summary, expandable markdown output. | **KEEP / light REFRAME** | Strong delivery-receipt view, already workflow-aware (`chain` badge for orchestration runs). Reframe copy from "skill runs" to "what your autopilot delivered," group by routine/workflow, and link each run back to its routine and workflow. Filters are stubbed ("Not implemented yet, page hard-codes last 50"). |
| `/roi` | "Skill ROI" / "Which of your saved skills are actually driving outcomes?" Top-line: Total invocations, Attributed outcomes, Attributed value. Per-skill leaderboard table. | **REFRAME** | Outcomes are the thing that ranks workflows and proves value, so this is strategically central, not a side page. Reframe to **Outcomes** ranked by **workflow** (not just skill), and surface it more prominently (it currently hangs off a `← Skills` breadcrumb, signalling it is a sub-page of Skills). |
| `/integrations` | "Integrations" / "Implexa captures workflows from any MCP server you have installed in Claude... we capture every workflow you run with them." | **KEEP** | Already the most workflow-native page in the product. Good model for tone. Also the natural home for the **capability map** (which MCP tools are local-only vs remote-safe) that the routine remote-verdict depends on. |
| `/leaderboard` | "Creator leaderboard" / "The Implexa creators whose shared skills are getting the most engagement." | **KEEP** | Community/karma flywheel; orthogonal to the autopilot story. Leave as-is. |
| `/install` (+ hero/flow/options) | "Install Implexa" / "One command per runtime... API key, hooks, the Implexa plugin, and MCP wiring." | **KEEP** | Onboarding plumbing; nav label "Connect Claude" is already action-framed. Copy leans "skill library"; minor reframe to "your routines run in your Claude" would help but low priority. |
| `/settings` and sub-pages (account, billing, team, api-keys, karma, data) | "Settings" hub of 8 tiles; Billing "5 captures/month" quota framing. | **KEEP** | Standard account surfaces. Billing quota framed around "captures" is fine; could later add a routines/runs quota line, low priority. |
| `/pricing` | plan comparison | **KEEP** | Marketing surface. |
| `/onboarding` (+ role picker) | "Welcome to Implexa" / "One last step, set up your workspace." Role-pack forks land in the library. | **KEEP / light REFRAME** | Onboarding forks "Playbooks" into the library and routes to `/install`. Once Workflows exist, onboarding should also seed/recommend a first **routine**, not only library skills. |
| `/admin` | "Admin" internal metrics | **KEEP** | Internal-only. |
| `/leaderboard`, `/cli-auth`, `/s/[token]`, `/forgot-password`, `/reset-password`, `/login`, `/signup` | auth + share surfaces | **KEEP** | Plumbing. (Login/signup default landing fixed, see section 7.) |

### 3c. Reusable components

| Component | Verdict | Notes |
|---|---|---|
| `_components/copy-run-command.tsx` | **KEEP** | Already takes `kind: 'skill' | 'workflow'` and emits "implexa run the {slug} workflow". Workflow-ready. |
| `_components/sidebar.tsx` `SetupChip` | **KEEP** | Autopilot connection health. |
| `scheduled/schedule-row.tsx` | **REFRAME** | Add a remote-safe/local-only chip and a "runs workflow X" link. `looksOverdue` already drives an `overdue` badge. |
| `skills/skills-library.tsx` | **KEEP** (inside the shelf) | Good 4-lens tab library; just lives under a demoted Skills nav. |
| `skills/run-in-claude-button.tsx`, `welcome-banner.tsx`, `recommendations-rail.tsx`, `founding-creator-banner.tsx` | **KEEP** | Library-side helpers. |
| `lib/routine-status.ts` (`looksOverdue`) | **KEEP / extend** | Coarse overdue heuristic. Needs a sibling `remoteSafety(workflow)` helper (or read from `get_routine_health`) to power the remote-safe verdict. |
| `lib/setup-status.ts` | **KEEP** | Mirrors backend; drives the chip. |
| `components/*` (logo, badges, share, star, download) | **KEEP** | Generic. |

---

## 4. Information-architecture problems

1. **Skills was the home.** Despite `app/page.tsx` redirecting authed users to `/overview`, the auth callback, `/login`, and `/signup` all defaulted to `/skills`, and the sidebar logo linked to `/skills`. So the first thing most users saw after sign-in was the ingredient shelf, not mission control. (Fixed in section 7.)
2. **No Workflows view.** The lead product has no route, no list, no detail. Workflows only exist as a word in copy and as an external marketing link from `/overview`.
3. **The autopilot loop is scattered and out of order.** Routines (`/scheduled`), Runs (`/runs`), and Outcomes (`/roi`) are the loop, but the nav put Skills between Overview and them, and ROI hangs off a `← Skills` breadcrumb as if it were a skills sub-page.
4. **Remote-safety is invisible.** The differentiator (capability-aware "move to remote," with browser/Chrome-MCP steps pinned local) is referenced in copy on `/overview` and `schedule-row` but never derived or shown per routine. A user cannot tell from the UI which routines are safe to move remote and which would break if moved.
5. **Outcomes are under-surfaced and skill-scoped.** The thing that "ranks workflows and proves value" lives on a quiet sub-page titled "Skill ROI," ranked by skill, not workflow.
6. **Workflow vs skill hierarchy is only asserted on one page.** `/overview` carefully explains "workflows are the lead, skills are the ingredients," but every other surface contradicts it by leading with skills.
7. **Runs and Routines do not link to the workflow they ran.** There is no way to go from a delivered run to "what workflow produced this" to "its other runs and its outcomes."

---

## 5. Missing workflow-first views (the NET-NEW list)

1. **`/workflows` (list).** The jobs the user runs, distinct from the skill shelf. Per row: name, what it does, step count, capability/remote verdict, schedule status (is it a routine?), last run, outcomes-to-date. Backed by `list_workflows` / a backend endpoint (RLS blocks raw catalog reads).
2. **`/workflows/[slug]` (detail).** Ordered steps with the verify gate, the outcome prior, and a **capability/remote verdict** ("Remote-safe" vs "Local-only: step 3 drives a browser"). Plus run history and attributed outcomes. Reuse the existing `inputs` / `output_contract` / `decision_points` / `outcome_signal` renderers from `skills/[slug]/page.tsx`.
3. **Remote-safety chip + explainer**, shared by `/workflows`, `/scheduled` rows, and `/overview` "Needs attention." Derived from the workflow's steps (browser/Chrome-MCP step => local-only) or read from `get_routine_health`.
4. **"Recommend a workflow" surface.** The loop step "detect recurring work -> recommend a workflow" exists in the backend (`detect_recurring_work`, `generate_workflow`) but has no dashboard home. `/overview`'s "Skills implexa noticed" should gain a sibling "Workflows we'd set up for you" with a one-click schedule.
5. **Outcomes-by-workflow** (reframed `/roi`): rank workflows, not just skills, and make it a top-level "Outcomes" destination.
6. **Routine -> workflow -> runs -> outcomes cross-links** so the four autopilot surfaces form a navigable loop.

---

## 6. Light/dark-mode readability issues (`darkMode: 'media'`)

These use raw color literals without `dark:` variants, or fixed light tints that do not flip:

- **Status badges without `dark:` variants.** `runs/page.tsx` and `scheduled/schedule-row.tsx` render `text-emerald-400`, `text-amber-400`, `text-rose-400` on `/15` backgrounds. In **light** mode, `emerald-400` (#34D399) text on a near-white card is low contrast. The correct pattern is already used on `/overview` (`text-amber-600 dark:text-amber-400`); the badges should match it (`text-emerald-600 dark:text-emerald-400`, etc.).
- **`bg-brand-50` cards do not flip.** `skills/page.tsx` first-time card (`!bg-brand-50 !border-brand-500/30`), `roi/page.tsx` (`bg-brand-50/30` top row, `bg-brand-50` on the outcome-signal code chip), and `skills/[slug]` (`bg-brand-50` chip). `brand-50` is a fixed light peach (#FFF2EC); in **dark** mode these render as bright near-white blocks against a near-black body. Replace with an ink/brand-tinted surface that flips (e.g. `bg-brand-500/10`).
- **`overview` StatCard is the reference implementation** for doing this right (`text-amber-600 dark:text-amber-400`, `text-emerald-600 dark:text-emerald-400`). Use it as the pattern when fixing the above.

None of these are blocking; they are a focused "make the status colors flip" pass.

---

## 7. Prioritized redo plan

### Top 5 (highest impact)

**1. Stand up a first-class Workflows view (the lead product). [NET-NEW]**
- Files: new `app/(dashboard)/workflows/page.tsx` (list) and `app/(dashboard)/workflows/[slug]/page.tsx` (detail); add `{ href: '/workflows', label: 'Workflows', icon: 'skills' }` near the top of `PRIMARY_NAV` in `sidebar.tsx`.
- Before: no route; `/overview` links out to `${SITE_URL}/workflows` on the marketing site.
- After: in-app list of the user's workflows and a detail page that reuses the `inputs` / `output_contract` / `decision_points` / `outcome_signal` renderers from `skills/[slug]/page.tsx`, plus a steps list, a remote verdict, run history, and outcomes.
- Data: needs a backend endpoint or MCP (`list_workflows` / `get_workflow`); raw catalog reads are RLS-blocked.

**2. Add the remote-safe vs local-only verdict everywhere routines appear. [NET-NEW]**
- Files: extend `lib/routine-status.ts` with a `remoteSafety()` helper (or read `get_routine_health`); render a chip in `scheduled/schedule-row.tsx`, `/workflows`, and `/overview` "Needs attention."
- Before: copy says "move it to a remote routine" but nothing shows which routines are safe to move.
- After: each routine shows "Remote-safe" or "Local-only (browser step)," and the "move to remote" nudge only appears when it is actually safe (it must never be offered for a browser-driven routine, which would break it).

**3. Reframe `/skills` as the ingredient shelf and demote it. [REFRAME] (nav demotion done, see below)**
- Files: `skills/page.tsx` header copy; `sidebar.tsx` order (done).
- Before: "Your skills / Your library. Fork, run, capture, share." Skills was the 2nd nav item and the default landing.
- After: lead with autopilot surfaces; reframe the Skills H1/subtitle so skills read as the components workflows are built from (e.g. "The ingredients. Skills are the building blocks your workflows are composed from."). Keep the 4-tab library intact.

**4. Promote Outcomes to a first-class autopilot surface, ranked by workflow. [REFRAME]**
- Files: `roi/page.tsx` (rename H1 "Skill ROI" -> "Outcomes," drop the `← Skills` breadcrumb, rank by workflow), and rename the nav label "ROI" -> "Outcomes" in `sidebar.tsx` once the H1 matches.
- Before: quiet sub-page of Skills, ranked by skill.
- After: top-level proof-of-value surface in the autopilot loop, workflow-ranked.

**5. Wire the loop: cross-link Routines <-> Workflows <-> Runs <-> Outcomes. [REFRAME]**
- Files: `scheduled/schedule-row.tsx`, `runs/page.tsx`, `overview/page.tsx`.
- Before: a run shows a `skill_slug` string with no link to its routine or the workflow that produced it.
- After: each run links to its routine and workflow; each routine links to its workflow and its runs; each workflow shows its routine + runs + outcomes.

### Long tail

- **Reframe `/runs` copy** from "Output log for scheduled + orchestrated skill runs" to "What your autopilot delivered," and ship the stubbed status/source filters (`runs/page.tsx` header comment admits they are not implemented).
- **Add a "Workflows we'd set up for you" block** to `/overview`, beside "Skills implexa noticed," backed by `detect_recurring_work` / `generate_workflow`, with one-click schedule.
- **Make `/overview` "Needs attention" explain the why** (remote-safe vs local-only) instead of the generic "move it to a remote routine" line.
- **Fix the color-literal readability issues** in section 6 (status badges -> `text-*-600 dark:text-*-400`; `bg-brand-50` -> a flipping surface).
- **Reframe onboarding** to seed/recommend a first routine, not only library forks (`onboarding/*`).
- **Light reframe of `/install` copy** from "skill library" to "your routines run in your Claude."
- **Add a routines/runs usage line to Billing** alongside the "captures/month" quota.

---

## 8. Quick wins implemented this session

All on branch `audit/workflow-first-redo`. Build verified green (`npm run build`). No `.env*` files touched. No em-dashes introduced.

1. **`/overview` is now the consistent post-auth home.** Changed the default landing from `/skills` to `/overview` in `app/auth/callback/route.ts`, `app/login/page.tsx`, and `app/signup/page.tsx`, matching the root redirect already in `app/page.tsx`. `next=` deep links still win.
2. **Sidebar logo points at mission control.** Both the desktop sidebar and `MobileTopBar` brand links in `sidebar.tsx` now go to `/overview` instead of `/skills`.
3. **Nav re-centered on the autopilot loop.** Reordered `PRIMARY_NAV` to `Overview, Routines, Runs, ROI, Skills, Integrations, Leaderboard, Connect Claude`, moving the autopilot surfaces above the ingredient shelf.
4. **"Scheduled" renamed to "Routines"** in the nav, matching the product's own language on `/overview`, in the watchdog, and in the `schedule-row` tooltip (the table is still `scheduled_skills`; only the label changed).
5. **`/scheduled` page header reframed** from "Scheduled skills / Recurring runs registered via /implexa:schedule" to "Routines / Your autopilot. Each routine runs a workflow on a schedule, then delivers the result." so the page H1 agrees with the new nav label.

Deliberately **not** auto-applied (left as plan items to avoid product decisions without review): the `/skills` and `/roi` copy reframes, the "ROI -> Outcomes" nav rename (waiting on the page H1), and all NET-NEW views.
