# Arbitrary local training source ingress

Linked draft PRs: [Backend #443](https://github.com/Implexa-Inc/implexa-backend/pull/443) → [Desktop #318](https://github.com/Implexa-Inc/implexa-desktop/pull/318) → [Dashboard #231](https://github.com/Implexa-Inc/implexa-dashboard/pull/231).

Draft implementation, based on backend fcc284a, Desktop b23b981 (0.4.8), and Dashboard e0368de1. No existing checkout, production database, Mac Mini file, provider, compositor, activation, or release was changed. PostgreSQL migration execution was confined to a newly initialized disposable fixture database.

## Audit: existing versus new

| Area | Current main | This change |
| --- | --- | --- |
| Training sessions | 0206 owner/version/task identity, immutable session digest, previous-work registration; raw_input vocabulary exists but refuses | Enable raw_input only through the new gated service ingress; keep owner-private exact version sessions |
| Source authority | agent_training_sources requires run/artifact and producing version provenance | New immutable agent_training_local_sources child of existing session. It cannot claim run provenance; role is owner_demonstration. It contains bounded metadata, SHA, opaque identity digest, machine identity and three explicit consents |
| Competence | 0348/#438 records, governance, frame descriptors, immutable events; every record requires a review and run acceptance | Reuse that table and event authority with a mutually exclusive local_source_id, structured visual decision and custody receipt. Draft has no acceptance event. Prior-run validation remains intact |
| Manager | 0349/#439 exact version/stage relevance, immutable selection, permit, materialization and handling receipts; missing coverage/handling fails | Reuse all of these. training_png tells Desktop to revalidate selected source custody before disclosure and after settlement. No new run inputs or automatic corpus injection |
| Desktop | #315 verifies/materializes selected Review PNG and descriptor evidence | Native dialog, streaming source SHA and stable regular-file checks, lsof writer refusal, bounded fd-based ffprobe/ffmpeg, frame preview, durable draft/retry registry, acceptance revalidation and selected-source verification |
| Dashboard | Training roster with unavailable-evidence copy | Agent Training page, consent, Add training source, progress/refusals, frame scrubber and preview, chosen/why/process/desired-behavior trace, positive/negative/contrast relation, draft acceptance and evidence list |

The source-kind discriminant currently accepts only local_file. URL and screen-recording ingestion require separately verified custody contracts; neither becomes a run input. The source is never presenter_video, revision_source_video, accepted_quality_reference, or a fabricated run artifact.

## Contract and boundaries

The Desktop main process is the trusted local custody producer, authenticated to the existing owner API. Renderer arguments cannot supply a filesystem path. Owner/organization/version/session identities come from authenticated backend reads and immutable session authority; backend source/record digests are computed in SQL. Only native selection can introduce a source path, and that path remains in the Desktop registry. Source bytes are read in 1 MiB chunks for hashing and never placed in backend JSON or model context.

Each decision requires four bounded fields: chosen, why, process, desiredBehavior. They are retained structurally and projected as the selected quality reference's bounded summary. A timestamp maps to a full-frame PNG (maximum 1280px capture edge, 8 MiB), with a hash, dimensions, timestamp anchor digest and exact source custody receipt. This slice deliberately refuses clips, crops, contact sheets and other unsupported derivatives as local evidence. Negative/contrast examples can be coach-accepted evidence without becoming positive examples.

Identical key replay returns the immutable record. A different key for an identical source/decision refuses as a duplicate rather than silently binding an unrecorded alias. Desktop saves submission bodies before sending, so a lost response can be retried after restart. Failed verification and failed annotation drafts remain local. Source mutation, missing source, active writer, mismatched PNG, scope mismatch, expired governance, absent consent or absent handling receipts fail closed. No UI claims an agent is “trained.”

Manager only chooses evidence matching its existing exact-version coverage policy. A newly accepted decision that does not match that policy remains unselected. Original source custody must remain available on the execution machine. Transfer to another machine, URL ingestion, screen capture, automatic learning, and agent version publication are outside this slice.

## Verification

- Real generated MP4 → Desktop registration without a new run → two timestamped accepted decisions and one unaccepted draft → a later synthetic attempt → actual PostgreSQL Manager selection → actual Desktop materialization → immutable disclosure and exact handling receipts.
- Source and decision restart/replay, lost response after commit, duplicate source key, positive/negative authority separation in the reused 129-assertion Manager smoke, forged other owner/agent/version, unaccepted draft exclusion, missing handling, unsupported derivative, source mutation, and no original path/full-video bytes in backend/model payload.
- Existing backend training/competence unit suites: 74 passed; new service tests: 2 passed.
- Desktop custody and Manager unit tests: 38 passed. Mutation suite kills removal of expected source identity and active-writer checks.
- Backend mutation suite kills removal of consent, owner and unsupported-derivative checks.
- Dashboard TypeScript and production build passed.
- Desktop packaging module smoke passed in `local-pack` mode: actual declared file set, ASAR/source digest checks and require graph. Full offline Electron packaging is **not verified**: default pack lacks the cached Electron download; explicitly using node_modules/electron/dist reports a corrupt/incomplete Electron distribution. These are environment failures, not test regressions. No signing/network guard was bypassed.

Commands (from respective isolated worktrees):

```sh
# Backend: disposable PostgreSQL, never an external DATABASE_URL
npm run test:acceptance:training-local -- ../implexa-desktop-training-source-ingress
npm run test:mutation:training-local -- ../implexa-desktop-training-source-ingress
node --test src/services/training-local.service.test.js
# Desktop
npm run test:training-local
npm run test:mutation:training-local
npm run smoke:packaged-training-local
# Dashboard
npx tsc --noEmit
npm run build
```

No live authenticated Dashboard/Electron interaction or production acceptance was performed. The real Mac Mini accepted baseline was not read or modified. The fixture uses generated media and synthetic database records, not the compositor.

## Dependency and rollout (instructions only; not executed)

1. Review backend first, reserving migration 0350 against concurrent main changes. Ship schema/backend with AGENT_TRAINING_LOCAL_ENABLED unset/false. Existing AGENT_TRAINING_WP1A_ENABLED and AGENT_COMPETENCE_R1_ENABLED must also be true for ingress.
2. Review Desktop against that backend. Produce and verify a real signed Desktop release, including a healthy Electron packaging runtime and installed media tools. Install it on the Mac Mini before enabling local ingress. Version 0.4.8 does not implement this bridge or training_png custody kind; **a Desktop release is required**.
3. Ship Dashboard after the compatible Desktop/backend are available. Web-only or old Desktop clients show an explicit update/Desktop requirement. Enable AGENT_TRAINING_LOCAL_ENABLED only after coordinated compatibility verification.
4. Repeat the owner's Mac Mini acceptance with the exact immutable agent/version and accepted video SHA stated in the task. Review/accept at least two visual decisions, then explicitly authorize a later run. Confirm actual selection and handling receipts; accepted evidence is not guaranteed to match every run's coverage policy.
5. Roll back ingress by turning its flag off. Do not delete immutable sources/evidence or roll back schema under accepted records. Keep compatible Desktop readers wherever accepted local evidence can be selected.
