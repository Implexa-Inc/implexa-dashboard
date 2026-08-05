// node --test "app/(dashboard)/_components/professional-v2-ui.test.ts"
//
// Assembly guards for the Professional v2 surface.
//
// These check the WIRING that a pure unit test cannot see: that the browser
// reaches the backend only through the authenticated Dashboard proxy, that no
// component mints its own authorization header or service-role client, that the
// approval control routes through the one gate, and that the Quick lane is still
// mounted exactly as it was.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const builder = read('./professional-broll-builder.tsx');
const editor = read('./professional-timeline-editor.tsx');
const card = read('./professional-v2-proposal-card.tsx');
const summary = read('./professional-cost-summary.tsx');
const entry = read('./broll-proposal-builder.tsx');
const proxy = read('../../api/generation-proposals/route.ts');
const page = read('../generations/[proposalId]/page.tsx');

const CLIENT_SOURCES: Array<[string, string]> = [
  ['professional-broll-builder', builder],
  ['professional-timeline-editor', editor],
  ['professional-v2-proposal-card', card],
  ['professional-cost-summary', summary],
];

test('every browser call goes through the authenticated Dashboard proxy', () => {
  for (const [name, source] of CLIENT_SOURCES) {
    for (const call of source.match(/fetch\((['"`])[^'"`]*\1/g) ?? []) {
      assert.match(call, /fetch\(['"`]\/api\/generation-proposals['"`]/, `${name}: ${call}`);
    }
  }
  assert.match(builder, /fetch\('\/api\/generation-proposals'/);
  assert.match(card, /fetch\('\/api\/generation-proposals'/);
});

/**
 * Comments explain the boundary and are expected to NAME it; code must not
 * touch it. Scanning the raw file would flag a comment that says "the Supabase
 * session stays server-side" — the very statement being enforced.
 */
const codeOnly = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no client component handles a token, a service-role key or the backend origin', () => {
  for (const [name, source] of CLIENT_SOURCES) {
    const code = codeOnly(source);
    for (const forbidden of [
      /authorization:/i, /Bearer/, /access_token/, /SERVICE_ROLE/i,
      /NEXT_PUBLIC_IMPLEXA_API_URL/, /core\.implexa\.ai/, /supabase/i, /createClient/,
    ]) {
      assert.doesNotMatch(code, forbidden, `${name} must not reference ${forbidden}`);
    }
  }
});

test('the proxy attaches the signed-in user’s Supabase JWT and never a service role', () => {
  assert.match(proxy, /supabase\.auth\.getSession\(\)/);
  assert.match(proxy, /session\?\.access_token/);
  assert.match(proxy, /authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(proxy, /status: 401/);
  assert.match(proxy, /resolveProposalAction/);
  // No generic passthrough: the action allowlist owns every upstream shape.
  assert.doesNotMatch(proxy, /SERVICE_ROLE/i);
  assert.doesNotMatch(proxy, /body\.path|body\.url|target\.headers/);
});

test('the builder previews before it creates, and single-flights the create', () => {
  assert.match(builder, /action: 'preview-professional-v2'/);
  assert.match(builder, /action: 'create-professional-v2'/);
  assert.match(builder, /parseProfessionalV2PreviewResponse/);
  assert.match(builder, /parseProfessionalV2CreateResponse/);
  assert.match(builder, /reconcileProposal/);
  assert.match(builder, /createFlight\.current/);
  assert.match(builder, /router\.push\(`\/generations\//);
  // Create is reachable only from a preview that describes the CURRENT timeline.
  assert.match(builder, /if \(createFlight\.current \|\| !previewIsCurrent \|\| !preview\) return;/);
});

test('editing invalidates the preview and its identity', () => {
  assert.match(builder, /setPreview\(null\)/);
  assert.match(builder, /setPreviewFingerprint\(null\)/);
  assert.match(builder, /previewFingerprint === fingerprint/);
});

test('the builder never decides availability for itself', () => {
  // Availability is read off the compiled document, never computed or defaulted.
  assert.match(builder, /preview\.availability !== true/);
  assert.doesNotMatch(builder, /availability\s*=\s*true/);
  assert.match(builder, /requiredMissingCapabilities/);
});

test('the approval control routes through the one gate and confirms the ceiling', () => {
  assert.match(card, /decideProfessionalApproval/);
  assert.match(card, /interpretProfessionalApprovalResponse/);
  assert.match(card, /invalidateApprovalRef/);
  assert.match(card, /confirmedMaximumCredits: confirmedCeiling \? compiled\.maximumCredits : null/);
  assert.match(card, /idempotencyKeyRef/);
  assert.match(card, /type="checkbox"/);
  // Availability gates the whole money section, not just the button's disabled state.
  assert.match(card, /const previewOnly = compiled\.availability !== true;/);
  assert.match(card, /\{!previewOnly && \(/);
  // No hand-rolled approve request may exist beside the gate.
  assert.doesNotMatch(card, /action: 'approve'/);
});

test('the card states coverage and takes as separate numbers', () => {
  assert.match(card, /\{compiled\.momentCount\} B-roll moment/);
  assert.match(card, /\{compiled\.candidateTaskCount\} generated take/);
  // The moment count and the take count are rendered from DIFFERENT fields. A
  // card that printed the take count as the moment count would read as more
  // finished timeline than the plan produces.
  assert.doesNotMatch(card, /\{compiled\.candidateTaskCount\} B-roll moment/);
  assert.match(summary, /coverageSummary/);
  assert.match(summary, /Hard maximum/);
  assert.match(summary, /Repair reserve/);
  assert.match(summary, /Expected/);
  // The label must say WHOSE numbers these are.
  assert.match(summary, /backend-compiled/);
  assert.match(summary, /local-estimate/);
});

test('the entry offers Professional as a lane, and Quick is unchanged', () => {
  assert.match(entry, /<ProfessionalBrollBuilder/);
  assert.match(entry, /aria-label="Generation lane"/);
  // The v1 flow's own calls and parsers are still exactly the ones it had.
  assert.match(entry, /action: 'preview', agentSubject, sourceRunId: runId, qualityMode,/);
  assert.match(entry, /action: 'create', agentSubject, sourceRunId: runId, qualityMode: mode,/);
  assert.match(entry, /parseGenerationPreviewSet/);
  assert.match(entry, /parseGenerationCreateResponse/);
  assert.match(entry, /createFlight\.current/);
  // Quick is the default lane, so nothing about the existing flow moves.
  assert.match(entry, /useState<EntryLane>\('quick'\)/);
});

test('the proposal page picks a card from the routed contract, not from field sniffing', () => {
  assert.match(page, /read\.contract === 'v2'/);
  assert.match(page, /<ProfessionalV2ProposalCard/);
  assert.match(page, /<GenerationProposalCard/);
  assert.doesNotMatch(page, /control_contract_version/);
  assert.doesNotMatch(page, /professional_control/);
});

test('the timeline editor enforces bounds from the pinned contract, not from literals', () => {
  assert.match(editor, /BOUNDS\.maxMoments/);
  assert.match(editor, /BOUNDS\.maxVariantsPerMoment/);
  assert.match(editor, /BOUNDS\.maxRepairsPerMoment/);
  assert.match(editor, /JUDGE_MODES_ALLOWING_REPAIR/);
  assert.match(editor, /maxSourcePromptChars/);
  assert.match(editor, /validateTimeline/);
  // Turning the Judge off drops the reserve in the same edit rather than leaving
  // an unreleasable reserve for the backend to refuse.
  assert.match(editor, /keepsRepair \? \{\} : \{ maxRepairs: 0 \}/);
  // Reorder is offered as an explicit fix, never applied silently.
  assert.match(editor, /sortMomentsByStart/);
  assert.match(editor, /outOfOrder &&/);
});
