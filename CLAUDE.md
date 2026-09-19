# implexa-dashboard

## How to work here

These rules exist because this codebase has only ever accreted: 246 tables created and 7
ever dropped, ~424k lines added and ~18k deleted (4%) in its first 4.5 months. That is the
result of building iteration-on-iteration with no deletion step. It is not a code-quality
problem and it is not fixed by a big refactor later — it is fixed by these rules, per change.

**1. Name what you replace.** Every change says what it supersedes. If it supersedes
nothing, say "net new" explicitly. Accretion must be a stated decision, never a default.

**2. Report deletions.** Every summary says what was removed. If nothing was removed, say
why not. Superseding something without deleting it leaves two live implementations.

**3. A refactor never changes tests.** Restructuring changes how code is organised, not
what it does, so its tests must pass untouched. If a change needs its tests rewritten it is
a behaviour change — put it in a separate commit and say so. The founder reviews by diff
stat, not by reading code, so this is the check that makes supervision possible.

**4. Extend, do not parallel.** Prefer changing an existing module over adding a second one
beside it. No parallel registries, no second pipeline for a variant of an existing job.

**5. No new env var or feature flag without a removal condition.** State who owns it and
what makes it go away. Backend `src` already carries 161 distinct env vars.

**6. Fix at the source.** Enforce upstream rather than validating-then-rejecting downstream.

**7. Never leave a feature half-deleted.** Removing something removes its routes, tables,
flags, UI and tests together. Half-deleted is worse than kept.

## Vocabulary (settled 2026-09-18 — binding on new code)

- **Agent** is the product concept and the sole scheduled artifact. Use it in all new code,
  routes, copy and schema.
- **Workflow** is legacy. It survives only as (a) dashboard routes being renamed to
  `/agents`, and (b) indexed public URLs on the marketing site. Never introduce it anew.
- **Skill** is internal machinery (binding pipeline, `skill_runs`), not a user-facing noun.
  Do not build user-facing "skills" surfaces.

## Scope

`ARCHITECTURE.md` in the Implexa strategy repo is canonical. Reconcile against it before
designing; architectural changes update it in the same PR.

Do not deploy, apply production migrations, or cut releases unless explicitly asked.

## Dashboard specifics

- **Every page under `app/(dashboard)` is auth-gated** — the layout redirects to `/login`.
  These pages are NOT indexed and carry no SEO value. All SEO lives in implexa-website.
- **Rare interruptions are modals, never inline.** A gate the user sees occasionally
  interrupts; a gate they see constantly is inline.
- **The dashboard pins a backend contract version.** A 200 response that nevertheless
  refuses usually means the pin is stale — check the pin before debugging the backend.
- The anchor validator silently drops unknown keys, so a client cannot feature-detect from
  a 200. Verify against the backend's actual contract.
