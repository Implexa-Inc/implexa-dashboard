// node --test "app/(dashboard)/_components/setup-tiers.test.ts"
//
// Guards for the three seams the 2026-07-18 review found. The dashboard half of
// the tier split shipped with NO tests at all; these cover the exact failures.
//
//   P0 — the Save gate demanded every declared field, so a user who answered all
//        required questions but left one preference blank could not save AT ALL,
//        leaving Run blocked on answers they had already given. Optional was
//        optional in the data and required in the UI.
//   P1 — requirement satisfaction ignored the per-agent grant, so a brand-new
//        agent read "everything's set up", the row collapsed, and the only way to
//        authorize it was hidden. That is the dead end PR #63 removed, rebuilt.
//   P1 — the Run gate must read required-only, or the tier split is cosmetic.
//
// Source-guard style (the repo's answer for un-importable .tsx server/client
// components) — anchored on render forms, never bare names, since prose matches
// first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(import.meta.dirname, f), 'utf8');

test('Save requires ONLY the required fields — a blank preference must not block saving', () => {
  const src = read('agent-setup-card.tsx');
  // The bug, verbatim: every() over the whole schema.
  assert.doesNotMatch(
    src,
    /const allFilled = setup\.schema\.every\(/,
    'gating Save on the FULL schema is what made optional preferences effectively required',
  );
  assert.match(src, /const requiredFields = setup\.schema\.filter\(\(f\) => !isOptional\(f\)\)/,
    'the card must separate the tiers');
  assert.match(src, /const allFilled = requiredFields\.every\(filled\)/,
    'Save unlocks on the REQUIRED fields alone');
  // A field carrying a default counts as optional here too, matching the backend
  // rule (normalizeConfigSchema): supplying a default implies optional.
  assert.match(src, /const isOptional = \(f: Field\) => !!f\.optional \|\| \(f\.default !== undefined/,
    'the client tier rule must match the server: a default implies optional');
});

test('preferences are visibly separated and individually escapable', () => {
  const src = read('agent-setup-card.tsx');
  assert.match(src, /Optional preferences/, 'the tiers must be visible, not just present in the data');
  assert.match(src, /These never block a run/, 'say so plainly — otherwise every field still reads as mandatory');
  assert.match(src, /\{isOptional\(f\) \? 'optional' : 'required'\}/,
    'required fields must be labelled too — otherwise an all-required agent still looks unclassified');
  // The two escapes, so a blank field is a decision rather than an unfinished form.
  assert.match(src, /Use default \(\{f\.default\}\)/, 'a defaulted preference needs a one-tap accept');
  assert.match(src, /Skipping is fine/, 'skipping must be stated as safe');
  assert.match(src, /\{isOptional\(f\) && !filled\(f\) && \(/, 'the affordances show only for an unanswered preference');
});

test('requirement satisfaction requires the PER-AGENT grant for an API route, while a verified browser route can satisfy browser-only work', () => {
  const src = read('activation-requirements.tsx');
  // API key route: both halves, never merely the machine boolean.
  assert.match(
    src,
    /const apiReady = \(s: \(typeof services\)\[number\]\) =>\s*\n?\s*!!s\.provider && s\.keyOnMachine && grants\?\.\[s\.provider\] === true;/,
    'an API route MUST be keyOnMachine AND granted-for-this-agent — the server cannot see grants',
  );
  assert.match(src, /const browserReady = \(s: \(typeof services\)\[number\]\) => s\.browserSession\?\.status === 'reachable';/,
    'a browser route is satisfied only by a verified reachable account, never a checkbox');
  assert.match(src, /const accessMode = \(s: \(typeof services\)\[number\]\) =>\s*\n?\s*s\.accessMode \?\? \(s\.apiKeyRequired === false \? 'browser' : s\.apiKeyRequired === true \? 'api' : 'unknown'\);/,
    'the dashboard must honor explicit accessMode and treat missing/nullable legacy booleans as unknown');
  assert.match(src, /if \(mode === 'browser'\) return browserReady\(s\);[\s\S]*?if \(mode === 'api_and_browser'\) return apiReady\(s\) && browserReady\(s\);[\s\S]*?return apiReady\(s\);/,
    'browser-only, api-only, combined, and unknown access must have separate readiness rules');
  // The server's weaker field must not be mistaken for satisfaction anywhere.
  assert.doesNotMatch(src, /filter\(\(s\) => s\.satisfied\)/, 'there is no server-side `satisfied` to trust');
  // Unknown grant state must never collapse a row.
  assert.match(src, /\.catch\(\(\) => \{ if \(alive\) setGrants\(null\); \}\)/,
    'a failed grant read must leave the row actionable, not silently satisfied');
  assert.match(src, /if \(!b\?\.keysGrantedFor\) \{ setGrants\(null\); return; \}/,
    'no bridge (plain web) is also "unknown", never granted');
});

test('a saved-but-ungranted row stays actionable and stops selling a second key', () => {
  const src = read('activation-requirements.tsx');
  assert.match(src, /const needsGrantOnly = !!s\.provider && s\.keyOnMachine;/,
    'the grant-only state must be named');
  assert.match(src, /Key already saved on this Mac\. No paste needed — just allow this agent to use it\./,
    'tell the user it is an authorization, not a purchase');
  // The founder's original complaint: "key ready" next to "Get it ↗". Also
  // guarded on s.url (2026-07-23): a stack-derived browser tool can have url:null.
  assert.match(src, /\{!keyReady && !needsGrantOnly && !browserOnly && s\.url && \(\s*\n\s*<a href=\{s\.url\}/,
    'never offer "Get it" for a key that already exists, nor a null-href link');
  assert.match(src, /\{!isReady && !needsGrantOnly && !browserOnly && \(\s*\n\s*<span className="text-\[11px\] px-1\.5/,
    'never show a cost badge for a key that already exists');
  // And the key control is always rendered for a vault-backed provider, so the
  // grant path can never be hidden.
  assert.match(src, /\{s\.provider && !browserOnly && !keyReady && <InlineAddKeyButton provider=\{s\.provider\} slug=\{slug\} \/>\}/,
    'the key/grant control must remain available for API and unknown routes, but not misrepresent browser-only work as requiring a key');
});

test('browser account setup is a reusable verified access method, never an unchecked claim', () => {
  const src = read('activation-requirements.tsx');
  assert.match(src, /function BrowserSessionAccess/, 'browser sign-in is a reusable service-row component');
  assert.match(src, /bridge\.connectAccount\(session\.domain\)/, 'the provider domain is opened only through the desktop bridge');
  assert.match(src, /bridge\.verifyAccount\(session\.domain\)/, 'the account must be verified after sign-in');
  assert.match(src, /out\?\.ok && out\.reachable/, 'only a successful authenticated probe may mark the route complete');
  assert.match(src, /This workflow uses \{s\.name\} in your local browser — no API key needed\./,
    'browser-only work explains why the API-key prompt is absent');
  assert.match(src, /has not proved whether it uses an API key or a signed-in browser/,
    'unknown provider access must not claim browser login is sufficient');
});

test('provider access remains visible in Setup and never hides behind the active-CTA branch', () => {
  const src = read('activation-card.tsx');
  const marker = '<div className="mt-5 flex items-start gap-3">';
  const split = src.indexOf(marker);
  assert.ok(split > 0, 'the lifecycle CTA branch must remain identifiable');
  const beforeCta = src.slice(0, split);
  const afterCta = src.slice(split);
  assert.match(beforeCta, /<ActivationRequirements req=\{checklist\.requirements\} slug=\{checklist\.slug\} onChanged=\{\(\) => router\.refresh\(\)\} \/>/,
    'requirements must render before the lifecycle CTA branches, including Setup for active agents');
  assert.doesNotMatch(afterCta, /<ActivationRequirements req=/,
    'a second, branch-gated render would reproduce the hidden-Setup regression');
});

test('provider rows remain inspectable after they are ready', () => {
  const src = read('activation-requirements.tsx');
  assert.match(src, /\{services\.map\(\(s\) => \{/,
    'all provider rows must render; showing only outstanding rows hides the access method once it is ready');
  assert.match(src, /✓ signed in/, 'a verified browser route must identify itself rather than disappear into a generic all-set message');
  assert.match(src, /✓ key allowed/, 'a granted local API key must identify its scoped status');
});

test('the Run gate reads required-only, or the whole split is cosmetic', () => {
  const src = read('agent-actions.tsx');
  assert.match(src, /const blocking = blockingQuestions \?\? pendingQuestions;/,
    'one derived gate value, with an older-backend fallback to the total');
  assert.match(src, /if \(blocking > 0\) \{ surfaceQuestions\(\); return; \}/, 'the click gate uses it');
  assert.doesNotMatch(src, /if \(pendingQuestions > 0\) \{ surfaceQuestions\(\)/,
    'gating on the TOTAL would let an optional preference block Run');
});

test('send/post permission is labelled as autopost-only and excluded from stall nudges', () => {
  const src = read('activation-card.tsx');
  assert.match(src, /it\.group === 'send' \? 'autopost only' : 'optional'/,
    'send/post is an optional autopilot switch, not a recommended stall-prevention grant');
  assert.match(src, /const ungrantedOptional = tier2\.filter\(\(i\) => i\.optional && i\.group !== 'send' && !optIns\[i\.group\]\)/,
    'leaving send/post off means draft-and-hold, not "your run may stall"');
  assert.doesNotMatch(src, /const ungrantedOptional = tier2\.filter\(\(i\) => i\.optional && !optIns\[i\.group\]\)/,
    'the old optional-nudge predicate nagged for send/post and made it feel required');
});

test('connection workaround checkbox persists while the user moves around the agent page', () => {
  const src = read('activation-card.tsx');
  assert.match(src, /const workAroundStoreKey = `implexa:connection-workarounds:\$\{checklist\.slug\}`;/,
    'workaround state must be scoped to the agent, not one global checkbox');
  assert.match(src, /window\.localStorage\.getItem\(workAroundStoreKey\)/,
    'the checkbox should restore after navigation/refresh');
  assert.match(src, /window\.localStorage\.setItem\(workAroundStoreKey, JSON\.stringify\(\[\.\.\.next\]\)\)/,
    'ticking the checkbox should save immediately, not wait for Activate');
  assert.match(src, /window\.localStorage\.removeItem\(workAroundStoreKey\)/,
    'unticking all workarounds should clear the persisted state');
});

test('Overview reports readiness from the honest server claim', () => {
  const page = read('../workflows/[slug]/page.tsx');
  assert.match(page, /filter\(\(x\) => !x\.keyOnMachine\)/, 'the page reads keyOnMachine, not a satisfied flag');
  assert.match(page, /blockingQuestions=\{checklist\?\.blockingQuestions\}/, 'the gate is threaded to the actions');
  assert.doesNotMatch(page, /allSatisfied/, 'the server no longer claims satisfaction — nothing may read it');
});

test('the Overview readiness action opens Setup and focuses the missing required answer', () => {
  const readiness = read('agent-readiness.tsx');
  const setup = read('agent-setup-card.tsx');

  assert.match(readiness, /^'use client';/, 'the action must execute in the browser, not render as a dead same-page link');
  assert.match(readiness, /window\.dispatchEvent\(new CustomEvent\('implexa-open-tab', \{ detail: \{ key: 'setup' \} \}\)\)/,
    'the action explicitly mounts the client-owned Setup tab');
  assert.match(readiness, /onClick=\{openSetup\}/, 'the visible Answer action invokes the tab/focus behavior');
  assert.doesNotMatch(readiness, /href=\{blocked \|\| optionalQuestions > 0 \?/,
    'a same-page Link must not be reused for the unmounted Setup panel');
  assert.match(readiness, /\[data-setup-required="true"\]\[data-setup-missing="true"\] input/,
    'focus targets the first unanswered required field, not merely the top of the card');
  assert.match(setup, /data-setup-required=\{isOptional\(f\) \? 'false' : 'true'\}/,
    'each setup field exposes its required tier to the recovery action');
  assert.match(setup, /data-setup-missing=\{filled\(f\) \? 'false' : 'true'\}/,
    'each setup field exposes whether it still needs an answer');
});

// P0 (2026-07-18, second review): the tier split stopped at activation. The
// PRE-RUN dialog still fetched every schema field, knew nothing about
// optional/default, and disabled "Save & run" if ANY displayed field was blank —
// so a preference that was correctly skippable during activation became required
// again at the first Run click. The split was undone one surface later.
//
// It also HID all saved settings once the user ticked "skip the setup review",
// which is how an agent silently re-runs with stale inputs and produces duplicate
// work: the user could no longer see what it was about to use.
test('the PRE-RUN dialog blocks on required fields only', () => {
  const src = read('agent-actions.tsx');
  assert.doesNotMatch(
    src,
    /disabled=\{setupSaving \|\| setupFields\.some\(\(f\) => \(setupValues\[f\.key\] \?\? ''\)\.toString\(\)\.trim\(\) === ''\)\}/,
    'blocking Run on EVERY displayed field re-requires optional preferences at run time',
  );
  assert.match(src, /const blankRequired = setupFields\.filter\(\(f\) => !isOptionalField\(f\) &&/,
    'one derived list of blocking blanks, optional excluded by construction');
  assert.match(src, /disabled=\{setupSaving \|\| blankRequired\.length > 0 \|\| missingRequiredInputs\(inputContract, inputBindings\)\.length > 0\}/,
    'the Run button uses it and also enforces required inputs from the versioned contract');
  assert.match(src, /if \(blankRequired\.length \|\| missingRequiredInputs\(inputContract, inputBindings\)\.length\) return;/,
    'and so does the submit guard');
});

test('the pre-run dialog knows the tier contract and shows it', () => {
  const src = read('agent-actions.tsx');
  // Same rule as the server and the setup card — one definition of "optional".
  assert.match(src, /const isOptionalField = \(f: SetupField\) =>\s*\n?\s*!!f\.optional \|\| \(f\.default !== undefined/,
    'the dialog must use the same optional rule as normalizeConfigSchema');
  assert.match(src, /optional\?: boolean;/, 'SetupField must carry optional');
  assert.match(src, /default\?: string \| null;/, 'SetupField must carry default');
  assert.match(src, /\{isOptionalField\(f\) \? 'optional' : 'required'\}/, 'each field is labelled with its tier');
  assert.match(src, /Use default \(\{f\.default\}\)/, 'a defaulted preference offers one-tap accept');
  assert.match(src, /Skipping won’t block this run\./, 'skipping must be stated as safe');
});

test('saved settings are COLLAPSED, never hidden, before a run', () => {
  const src = read('agent-actions.tsx');
  // The old flag emptied the fields entirely.
  assert.doesNotMatch(src, /setSetupFields\(reviewed \? \[\] : schema\)/,
    'hiding the settings is what let an agent re-run on stale inputs the user could not see');
  assert.match(src, /setSetupFields\(durableSetup\);/,
    'durable settings are always loaded; versioned run inputs render in their typed section');
  assert.match(src, /setSetupOpen\(!setupCollapsed\(slug\)\)/, 'the preference only controls collapse');
  assert.match(src, /Review settings/, 'there is a visible settings section');
  // Collapsed still SHOWS the current values, so "what will it use?" is answerable
  // without expanding.
  assert.match(src, /\{!setupOpen && \(/, 'a collapsed summary must exist');
  assert.match(src, /Start with settings collapsed next time/, 'the opt-out collapses rather than hides');
});

test('saving setup answers refreshes the parent checklist and Run CTA', () => {
  const setup = read('agent-setup-card.tsx');
  assert.match(setup, /onSaved\?: \(\) => void;/,
    'the setup card must expose a save callback for parent state');
  assert.match(setup, /onSaved\?\.\(\);/,
    'the callback must fire after the backend accepts the saved answers');
  assert.match(setup, /import \{ useRouter \} from 'next\/navigation';/,
    'the setup card itself must be able to refresh server-derived CTA state');
  assert.match(setup, /const router = useRouter\(\);/,
    'saving answers must not rely only on parents remembering to pass a callback');
  assert.match(setup, /onSaved\?\.\(\);\s*\n[\s\S]{0,800}?router\.refresh\(\);/,
    'the route refresh must happen after the backend accepts saved answers so sibling Run CTAs update immediately');

  const activation = read('activation-card.tsx');
  assert.match(
    activation,
    /<AgentSetupCard slug=\{checklist\.slug\} source=\{checklist\.source\} onSaved=\{\(\) => router\.refresh\(\)\} \/>/,
    'the activation card must refresh its stale blockingQuestions prop after answers save',
  );
  assert.doesNotMatch(
    activation,
    /<AgentSetupCard slug=\{checklist\.slug\} source=\{checklist\.source\} \/>/,
    'leaving the parent unwired reproduces “✓ all set” above “Answer N questions to run”',
  );
});

// ── Duplicate-work backstop ──────────────────────────────────────────────────
// The founder's concern: per-run inputs look like durable settings, so a Run that
// reuses saved answers can silently redo work — a second paid render off the same
// files. Field-lifetime classification is the prevention layer; this is detection,
// shipped first because it needs no model judgement and protects agents that
// already exist.
test('the duplicate check runs BEFORE queueing, exactly once', () => {
  const src = read('agent-actions.tsx');
  assert.match(src, /if \(!opts\?\.force\) \{\s*\n\s*const pre = await precheckDuplicate\(note, runFiles\);/,
    'the check must precede the queue call');
  assert.match(src, /setDupe\(\{ message: d\.message, runId: d\.runId \?\? null, fingerprint \}\);\s*\n\s*return;/,
    'a hit must stop and ask — nothing queued yet');
  // force = the user already saw the warning. Re-asking would loop the confirm.
  assert.match(src, /doQueue\(lastNote\.current, \{ force: true, fingerprint: fp \}\)/,
    '"Run again anyway" must bypass the check and carry the fingerprint through');
});

test('the note survives the duplicate detour', () => {
  const src = read('agent-actions.tsx');
  const body = src.slice(src.indexOf('async function doQueue'), src.indexOf('async function doQueue') + 900);
  const notePos = body.indexOf('lastNote.current = note;');
  const checkPos = body.indexOf('const pre = await precheckDuplicate');
  assert.ok(notePos !== -1 && checkPos !== -1);
  assert.ok(notePos < checkPos,
    'lastNote must be set BEFORE the early return, or "Run again anyway" replays with the note dropped');
});

test('the backstop fails OPEN — it can never block a run', () => {
  const src = read('agent-actions.tsx');
  assert.match(src, /\} catch \{ return \{ fingerprint: null, duplicate: null \}; \}/,
    'a failed precheck must return no-duplicate, never throw into the Run path');
});

test('the confirm asks rather than blocks, and points at the prior run', () => {
  const src = read('agent-actions.tsx');
  assert.match(src, /title="Run this again\?"/);
  assert.match(src, /Run again anyway/, 'the user must always be able to proceed');
  assert.match(src, /See what that run produced →/, 'let them check before deciding');
  assert.match(src, /will redo that work — and spend whatever it costs again/,
    'name the real cost; that is the whole reason to interrupt');
});

// P1 (2026-07-18, third review): a capability-card "Run anyway" retry LOST the
// fingerprint. The first doQueue() prechecks and computes it locally; if capability
// preflight 409s, CapabilityCard retries with { force: true } — and `force`
// deliberately skips the precheck so the confirm cannot loop, which means the retry
// has no other way to obtain one. The eventual request was stored unstamped and
// could never trigger a future duplicate warning: leaky in exactly the case where
// the user already hit friction and is most likely to re-run.
test('the fingerprint survives a capability-409 "Run anyway" retry', () => {
  const src = read('agent-actions.tsx');
  // It must be remembered across attempts, not just live inside one doQueue call.
  assert.match(src, /const lastFingerprint = useRef<string \| null>\(null\);/,
    'the prechecked fingerprint needs a ref alongside lastNote');
  assert.match(src, /lastFingerprint\.current = pre\.fingerprint;/,
    'every precheck must record it');
  // The capability retry must carry it through.
  assert.match(
    src,
    /onRetry=\{\(o\) => doQueue\(lastNote\.current, \{ \.\.\.o, fingerprint: lastFingerprint\.current \}\)\}/,
    'the capability card retry must pass the remembered fingerprint, or a forced run is stored unstamped',
  );
  assert.doesNotMatch(src, /onRetry=\{\(o\) => doQueue\(lastNote\.current, o\)\}/,
    'passing the opts through bare is exactly what dropped it');
  // And a forced call must fall back to the ref rather than to null.
  assert.match(src, /let fingerprint = opts\?\.fingerprint \?\? lastFingerprint\.current \?\? null;/,
    'force skips the precheck, so it must read the remembered value');
});

test('a NEW pre-run clears the remembered fingerprint', () => {
  // Otherwise a stale fingerprint could be stamped onto a run whose note or files
  // have since changed — a false duplicate match on genuinely different work.
  const src = read('agent-actions.tsx');
  const open = src.slice(src.indexOf('async function openPreRun'), src.indexOf('async function openPreRun') + 700);
  assert.match(open, /lastFingerprint\.current = null;/,
    'a fresh attempt must not inherit the previous attempt\'s fingerprint');
});

test('newly-built agents send the user to review steps before activation', () => {
  const building = read('building-agents.tsx');
  assert.match(
    building,
    /href=\{b\.workflowSlug \? `\/workflows\/\$\{encodeURIComponent\(b\.workflowSlug\)\}` : '\/workflows'\}/,
    'the build-complete card must open the agent page, not the activation checklist',
  );
  assert.match(building, /Review agent/, 'the CTA should say review, not setup');
  assert.doesNotMatch(building, /Set up & activate/, 'activation copy would push users past the actual steps');

  const list = read('agents-list.tsx');
  assert.match(
    list,
    /a\.section === 'not_activated' \? \(\s*\n\s*<Link href=\{detail\}[\s\S]{0,160}>\s*\n\s*Review\s*\n\s*<\/Link>/,
    'draft rows should open the detail page first so the user sees the steps',
  );
  assert.doesNotMatch(
    list,
    /a\.section === 'not_activated' \? \(\s*\n\s*<Link href=\{`\/workflows\/\$\{encodeURIComponent\(a\.slug\)\}\/activate`\}/,
    'draft rows must not deep-link straight into activation',
  );

  const home = read('agents-home.tsx');
  const row = home.slice(home.indexOf('function NeedsRow'), home.indexOf('function ActiveRow'));
  assert.match(row, /href=\{`\/workflows\/\$\{a\.slug\}`\}/, 'Home needs-activation rows review first');
  assert.match(row, />Review<\/Link>/, 'Home needs-activation CTA should say Review');
  assert.doesNotMatch(row, /\/activate/, 'Home needs-activation rows must not bypass the step view');
});

test('the Setup tab keeps the permissions/access editor after activation', () => {
  const page = read('../workflows/[slug]/page.tsx');
  assert.match(page, /import \{ ActivationCard \} from '\.\.\/\.\.\/_components\/activation-card';/,
    'the reusable activation checklist must be available to the Setup tab');
  // Matched on the two props this test is ABOUT (mounted, and mounted as the setup
  // surface) rather than on the exact prop list: the card also takes the run-input
  // contract now, and pinning the full attribute string here made an unrelated
  // correct change fail a test whose subject is "Setup still has the editor".
  // The run-input props have their own guard — lib/run-input-surface-parity.test.ts.
  assert.match(page, /\{checklist && <ActivationCard\b[^>]*\bchecklist=\{checklist\}[^>]*\bsurface="setup"/,
    'Setup must render the permissions/access checklist instead of losing it after activation');

  const card = read('activation-card.tsx');
  assert.match(card, /surface\?: 'activation' \| 'setup';/,
    'ActivationCard must have an explicit setup surface, not a second ad-hoc permissions UI');
  assert.match(card, /setupSurface \? 'Permissions & access' : checklist\.name/,
    'the setup surface should label the card as editable access, not as the activation page');
  assert.match(card, /setupSurface && isActive && allSavedGranted \? null : isActive && allSavedGranted/,
    'an active setup card should not duplicate Run/questions/feedback — only access controls');
});

test('agent roster shows the last engine/model instead of hiding the executor that ran it', () => {
  const list = read('agents-list.tsx');
  assert.match(list, /executor\?: string \| null;/,
    'the roster type must carry lastRun.executor from /me/agents');
  assert.match(list, /model\?: string \| null;/,
    'the roster type must carry lastRun.model from /me/agents');
  assert.match(list, /function engineLabel\(lastRun: ListAgent\['lastRun'\]\)/,
    'engine display should be a named helper, not an ad-hoc invisible field');
  assert.match(list, /title=\{`Last run used \$\{engine\}`\}/,
    'the chip should expose the exact engine/model used by the latest run');
  assert.match(list, /\{engine && \(/,
    'the engine chip must actually render on the row');

  const home = read('agents-home.tsx');
  assert.match(home, /function engineLabel\(a: MyAgent\)/,
    'Home agent rows must share the same engine visibility');
  assert.match(home, /title=\{`Last run used \$\{engine\}`\}/,
    'Home should expose the exact engine/model used by the latest run too');

  const feed = read('../../../lib/agents-home.ts');
  assert.match(feed, /executor\?: string \| null;/,
    'the dashboard feed type must not drop lastRun.executor before components see it');
  assert.match(feed, /model\?: string \| null;/,
    'the dashboard feed type must not drop lastRun.model before components see it');
});
