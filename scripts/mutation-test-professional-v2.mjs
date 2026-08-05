#!/usr/bin/env node
/**
 * Mutation harness for the Professional v2 Dashboard lane.
 *
 * A passing test suite proves the code does what the tests say. It does not
 * prove the tests would NOTICE if the code stopped doing it. Each mutation below
 * is a specific way this surface could quietly become dishonest about paid work —
 * routing a v2 plan through the Quick parser, treating a blank discriminator as
 * absence, letting overlapping moments through, preferring a browser-computed
 * ceiling, presenting variants as timeline coverage, approving an answer nothing
 * verified, or reaching the backend without the user's JWT. Every one must be
 * KILLED by a test, not merely caught in review.
 *
 * Each mutant runs against the WHOLE suite for this lane plus the pre-existing
 * v1 suites, so a mutation that breaks Quick is caught by Quick's own tests.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Everything the suites below need, at its real path. */
const FILES = [
  'lib/professional-v2.fixtures.ts',
  'lib/generation-source.ts',
  'lib/generation-source.test.ts',
  'lib/professional-v2-contract.ts',
  'lib/professional-v2-timeline.ts',
  'lib/generation-control-contract.ts',
  'lib/generation-proposal-v2.ts',
  'lib/generation-proposal-v2-envelope.ts',
  'lib/generation-proposal-routed.ts',
  'lib/professional-v2-entry.ts',
  'lib/generation-proposal.ts',
  'lib/generation-proposal.fixtures.ts',
  'lib/generation-proposal-entry.ts',
  'lib/generation-proposal-actions.ts',
  'lib/quality-mode.ts',
  'lib/professional-v2-contract.test.ts',
  'lib/professional-v2-timeline.test.ts',
  'lib/generation-control-contract.test.ts',
  'lib/generation-proposal-v2.test.ts',
  'lib/professional-v2-entry.test.ts',
  'lib/generation-proposal-routed.test.ts',
  'lib/generation-proposal-actions-v2.test.ts',
  // The pre-existing v1 suites. A mutant that changes Quick/v1 behaviour must be
  // killed HERE, by the tests that were already guarding it.
  'lib/generation-proposal.test.ts',
  'lib/generation-proposal-entry.test.ts',
  'app/(dashboard)/runs/[id]/generation-entry.test.ts',
  // Read as text by the assembly guards.
  'app/(dashboard)/_components/professional-v2-ui.test.ts',
  'app/(dashboard)/_components/professional-broll-builder.tsx',
  'app/(dashboard)/_components/professional-timeline-editor.tsx',
  'app/(dashboard)/_components/professional-v2-proposal-card.tsx',
  'app/(dashboard)/_components/professional-cost-summary.tsx',
  'app/(dashboard)/_components/broll-proposal-builder.tsx',
  'app/api/generation-proposals/route.ts',
  'app/(dashboard)/generations/[proposalId]/page.tsx',
  'app/(dashboard)/runs/[id]/generate-broll/page.tsx',
];

const SUITES = [
  'lib/professional-v2-contract.test.ts',
  'lib/professional-v2-timeline.test.ts',
  'lib/generation-control-contract.test.ts',
  'lib/generation-proposal-v2.test.ts',
  'lib/professional-v2-entry.test.ts',
  'lib/generation-proposal-routed.test.ts',
  'lib/generation-proposal-actions-v2.test.ts',
  'lib/generation-proposal.test.ts',
  'lib/generation-proposal-entry.test.ts',
  'app/(dashboard)/_components/professional-v2-ui.test.ts',
  // The source-duration boundary's own suite.
  'lib/generation-source.test.ts',
  'app/(dashboard)/runs/[id]/generation-entry.test.ts',
];

const CONTRACT = 'lib/generation-control-contract.ts';
const TIMELINE = 'lib/professional-v2-timeline.ts';
const DOC = 'lib/generation-proposal-v2.ts';
const ENTRY = 'lib/professional-v2-entry.ts';
const ROUTED = 'lib/generation-proposal-routed.ts';
const ACTIONS = 'lib/generation-proposal-actions.ts';
const PROXY = 'app/api/generation-proposals/route.ts';
const BUILDER = 'app/(dashboard)/_components/professional-broll-builder.tsx';
const CARD = 'app/(dashboard)/_components/professional-v2-proposal-card.tsx';
const PAGE = 'app/(dashboard)/generations/[proposalId]/page.tsx';
const ENTRY_PAGE = 'app/(dashboard)/runs/[id]/generate-broll/page.tsx';
const ENTRY_BUILDER = 'app/(dashboard)/_components/broll-proposal-builder.tsx';
const SOURCE = 'lib/generation-source.ts';

const mutations = [
  // ── 0. THE SOURCE-DURATION BOUNDARY ──────────────────────────────────────
  // The browser is not the gate — the backend is, twice. But a browser that
  // INVENTS a ceiling, or renders a plan whose bound it cannot state, teaches
  // the user something false about what they are about to authorize.
  {
    boundary: 'source-duration', name: 'null duration treated as unlimited', file: SOURCE,
    from: '  if (!isAuthoritativeDurationMs(mediaDurationMs)) return false;',
    to: '  if (!isAuthoritativeDurationMs(mediaDurationMs)) return true;',
  },
  {
    boundary: 'source-duration', name: 'one millisecond past the source accepted', file: SOURCE,
    from: '  return startMs < mediaDurationMs && endMs <= mediaDurationMs;',
    to: '  return startMs < mediaDurationMs && endMs <= mediaDurationMs + 1;',
  },
  {
    boundary: 'source-duration', name: 'a browser-supplied string duration coerced into a number', file: SOURCE,
    from: '  return typeof value === \'number\'\n    && Number.isSafeInteger(value)',
    to: '  return Number.isSafeInteger(Number(value))',
  },
  {
    boundary: 'source-duration', name: 'a source artifact chosen implicitly when several exist', file: SOURCE,
    from: "  if (sources.length > 1) return { state: 'ambiguous', sources };",
    to: '  if (sources.length > 1) return { state: sources[0].mediaDurationMs === null ? \'needs_verification\' : \'eligible\', source: sources[0], sources };',
  },
  {
    boundary: 'source-duration', name: 'an unverified source reported as eligible', file: SOURCE,
    from: "  if (duration === null) return { state: 'needs_verification', sources };",
    to: '  if (false) return { state: \'needs_verification\', sources };',
  },
  {
    boundary: 'source-duration', name: 'a malformed artifact row read as "no video"', file: SOURCE,
    from: "    if (!(typeof artifact.id === 'string' && UUID.test(artifact.id))) return { state: 'unavailable' };",
    to: '    if (!(typeof artifact.id === \'string\' && UUID.test(artifact.id))) continue;',
  },
  {
    boundary: 'source-duration', name: 'the timeline stops enforcing the ceiling', file: TIMELINE,
    from: '        } else if (!withinSourceDuration(toMs(moment.startSeconds), toMs(moment.endSeconds), mediaDurationMs)) {',
    to: '        } else if (false) {',
  },
  {
    boundary: 'source-duration', name: 'an unknown duration silently accepted by the editor', file: TIMELINE,
    from: '        if (!isAuthoritativeDurationMs(mediaDurationMs)) {',
    to: '        if (false) {',
  },
  {
    boundary: 'source-duration', name: 'an out-of-range timeline is serialized anyway', file: TIMELINE,
    from: '  if (!validateTimeline(moments, mediaDurationMs).ok) return null;',
    to: '  if (!validateTimeline(moments).ok) return null;',
  },
  {
    boundary: 'source-duration', name: 'a v2 document with no source binding is rendered as a plan', file: DOC,
    from: '  const sourceBinding = parseSourceBinding(v.source_binding, moments);\n  if (!sourceBinding) return null;',
    to: '  const sourceBinding = parseSourceBinding(v.source_binding, moments) || { sourceRunId: \'\', sourceArtifactId: \'\', sourceArtifactSha256: \'\', mediaDurationMs: 1, windows: [] };',
  },
  {
    boundary: 'source-duration', name: 'a binding whose windows disagree with the graph is accepted', file: DOC,
    from: '    if (!window || window.startMs !== moment.startMs || window.endMs !== moment.endMs) return null;',
    to: '    if (false) return null;',
  },
  {
    boundary: 'source-duration', name: 'a plan compiled against a DIFFERENT source is accepted', file: ENTRY,
    from: '  if (compiled.sourceBinding.sourceArtifactId !== expected.sourceArtifactId) return false;',
    to: '  if (false) return false;',
  },
  {
    boundary: 'source-duration', name: 'switching the source does not invalidate the approval', file: ENTRY,
    from: "  if (ref.sourceArtifactId !== vm.compiled.sourceBinding.sourceArtifactId) return refuse('source_changed');",
    to: '  if (false) return refuse(\'source_changed\');',
  },
  {
    boundary: 'source-duration', name: 'Quick sends a moment past the end of its source', file: ENTRY_BUILDER,
    from: '    if (!withinSourceDuration(',
    to: '    if (false && !withinSourceDuration(',
  },
  {
    boundary: 'source-duration', name: 'the entry page compiles against an unverified source', file: ENTRY_PAGE,
    from: '  if (!source) {',
    to: '  if (false) {',
  },

  // ── 1. INFERRING v2 FROM SHAPE ───────────────────────────────────────────
  {
    boundary: 'discriminator', name: 'v2 inferred from the presence of a control graph', file: CONTRACT,
    from: "  if (!('control_contract_version' in document) || document.control_contract_version === undefined) {\n    return { kind: 'v1' };\n  }",
    to: "  if (!('control_contract_version' in document) || document.control_contract_version === undefined) {\n    return document.professional_control && (document.professional_control as Record<string, unknown>).moments\n      ? { kind: 'v2' } : { kind: 'v1' };\n  }",
  },
  {
    boundary: 'discriminator', name: 'v2 inferred from the v2-only cost fields', file: CONTRACT,
    from: "    const borrowed = V2_ONLY_FIELDS.filter((field) => field in doc);\n    if (borrowed.length) return { contract: 'malformed', reason: `v1_document_carries_v2_fields:${borrowed.join(',')}` };\n    return { contract: 'v1', document: doc };",
    to: "    const borrowed = V2_ONLY_FIELDS.filter((field) => field in doc);\n    if (borrowed.length) return { contract: 'v2', document: doc };\n    return { contract: 'v1', document: doc };",
  },

  // ── 2. NULL / BLANK / TRIMMED DISCRIMINATOR TREATED AS v1 ────────────────
  {
    boundary: 'discriminator', name: 'falsy discriminator treated as absence', file: CONTRACT,
    from: "  if (!('control_contract_version' in document) || document.control_contract_version === undefined) {",
    to: "  if (!document.control_contract_version) {",
  },
  {
    boundary: 'discriminator', name: 'discriminator trimmed before comparison', file: CONTRACT,
    from: '  const declared = document.control_contract_version;',
    to: '  const declared = typeof document.control_contract_version === \'string\' ? document.control_contract_version.trim() : document.control_contract_version;',
  },
  {
    boundary: 'discriminator', name: 'unknown discriminator defaulted to v1', file: CONTRACT,
    from: "  return { kind: 'malformed', reason: 'unknown_control_contract_version' };",
    to: "  return { kind: 'v1' };",
  },

  // ── 3. OVERLAPPING MOMENTS ALLOWED ───────────────────────────────────────
  {
    boundary: 'timeline', name: 'editor allows overlapping moments', file: TIMELINE,
    from: "      } else if (moment.startSeconds < previous.endSeconds) {",
    to: "      } else if (false && moment.startSeconds < previous.endSeconds) {",
  },
  {
    boundary: 'timeline', name: 'editor allows out-of-order moments', file: TIMELINE,
    from: '      if (moment.startSeconds < previous.startSeconds) {',
    to: '      if (false && moment.startSeconds < previous.startSeconds) {',
  },
  {
    boundary: 'timeline', name: 'editor treats abutting moments as overlapping', file: TIMELINE,
    from: '      } else if (moment.startSeconds < previous.endSeconds) {',
    to: '      } else if (moment.startSeconds <= previous.endSeconds) {',
  },
  {
    boundary: 'timeline', name: 'parser accepts an overlapping compiled timeline', file: DOC,
    from: '    if (previous && startMs < previous.endMs) return null;',
    to: '    if (false && previous && startMs < previous.endMs) return null;',
  },
  {
    boundary: 'timeline', name: 'proxy allowlist accepts an overlapping timeline', file: ACTIONS,
    from: "    if (previousEnd !== null && start < previousEnd) return 'Moments may touch, but they may not overlap.';",
    to: "    if (false) return 'Moments may touch, but they may not overlap.';",
  },

  // ── 4. CLIENT-CALCULATED CREDITS PREFERRED OVER BACKEND CREDITS ──────────
  {
    boundary: 'cost', name: 'reconciliation always passes', file: TIMELINE,
    from: "  if (!local) return { ok: false, reason: 'The plan could not be priced locally, so its cost cannot be confirmed.' };",
    to: "  return { ok: true };\n  if (!local) return { ok: false, reason: 'unused' };",
  },
  {
    boundary: 'cost', name: 'a mismatched backend ceiling is tolerated', file: TIMELINE,
    from: '  if (local.expectedCredits !== backend.initialCredits\n    || local.repairReserveCredits !== backend.repairReserveCredits\n    || local.maximumCredits !== backend.maximumCredits) {',
    to: '  if (false) {',
  },
  {
    boundary: 'cost', name: 'the envelope may restate a different maximum than its graph', file: DOC,
    from: '  if (v.maximum_credits !== graph.maximumCredits) return null;',
    to: '  if (false) return null;',
  },
  {
    boundary: 'cost', name: 'the graph cost block need not equal its tasks', file: DOC,
    from: '  if (!isObject(cost)\n    || cost.initial_credits !== initialCredits\n    || cost.repair_reserve_credits !== repairReserveCredits\n    || cost.maximum_credits !== initialCredits + repairReserveCredits) return null;',
    to: '  if (!isObject(cost)) return null;',
  },
  {
    boundary: 'cost', name: 'a task may be priced away from its moment rate', file: DOC,
    from: '        if (task.credits !== raw.credits_per_task) return null;',
    to: '        if (false) return null;',
  },

  // ── 5. VARIANTS CONVERTED INTO TIMELINE COVERAGE ─────────────────────────
  {
    boundary: 'coverage', name: 'coverage counted as generated takes', file: TIMELINE,
    from: '      coverageMomentCount: moments.length,',
    to: '      coverageMomentCount: variantTaskCount,',
  },
  {
    boundary: 'coverage', name: 'the coverage sentence describes takes as moments', file: TIMELINE,
    from: "  const moments = `${cost.coverageMomentCount} B-roll moment${cost.coverageMomentCount === 1 ? '' : 's'}`;",
    to: "  const moments = `${cost.variantTaskCount} B-roll moment${cost.variantTaskCount === 1 ? '' : 's'}`;",
  },
  {
    boundary: 'coverage', name: 'the "takes are not coverage" sentence is dropped', file: TIMELINE,
    from: '  return `${moments} of finished timeline — from ${takes}. Extra takes are alternatives for the same moments; they do not add coverage.`;',
    to: '  return `${moments} of finished timeline — from ${takes}.`;',
  },
  {
    boundary: 'coverage', name: 'the card prints takes where moments belong', file: CARD,
    from: '            Professional timeline — {compiled.momentCount} B-roll moment{compiled.momentCount === 1 ? \'\' : \'s\'}',
    to: '            Professional timeline — {compiled.candidateTaskCount} B-roll moment{compiled.candidateTaskCount === 1 ? \'\' : \'s\'}',
  },

  // ── 6. REPAIR ALLOWED WITH THE JUDGE OFF ─────────────────────────────────
  {
    boundary: 'repair-judge', name: 'editor allows a reserve with judging off', file: TIMELINE,
    from: '    } else if (moment.maxRepairs > 0 && !JUDGE_MODES_ALLOWING_REPAIR.includes(moment.judgeMode)) {',
    to: '    } else if (false) {',
  },
  {
    boundary: 'repair-judge', name: 'parser accepts a compiled reserve with judging off', file: DOC,
    from: "    if (maxRepairs > 0 && judgeMode === 'off') return null;",
    to: "    if (false) return null;",
  },
  {
    boundary: 'repair-judge', name: 'proxy allowlist accepts a reserve with judging off', file: ACTIONS,
    from: "    if ((maxRepairs as number) > 0 && !(JUDGE_MODES_ALLOWING_REPAIR as readonly string[]).includes(judgeMode)) {",
    to: "    if (false) {",
  },
  {
    boundary: 'repair-judge', name: 'the terminal state need not match the Judge mode', file: DOC,
    from: '    if (raw.terminal_state !== expectedTerminal) return null;',
    to: '    if (false) return null;',
  },

  // ── 7. PROPOSAL IDENTITY REUSED AFTER AN EDIT ────────────────────────────
  {
    boundary: 'identity', name: 'editing no longer invalidates the approval reference', file: ENTRY,
    from: '  if (!ref.proposalId || !ref.proposalVersion || !ref.proposalDigest || !ref.graphDigest) return refuse(\'edited\');',
    to: '  if (false) return refuse(\'edited\');',
  },
  {
    boundary: 'identity', name: 'a changed timeline fingerprint is ignored', file: ENTRY,
    from: '  if (ref.timelineFingerprint !== null\n    && input.currentTimelineFingerprint !== null\n    && ref.timelineFingerprint !== input.currentTimelineFingerprint) return refuse(\'timeline_changed\');',
    to: '  if (false) return refuse(\'timeline_changed\');',
  },
  {
    boundary: 'identity', name: 'a changed graph digest is ignored', file: ENTRY,
    from: "  if (ref.graphDigest !== vm.compiled.graphDigest) return refuse('graph_changed');",
    to: "  if (false) return refuse('graph_changed');",
  },
  {
    boundary: 'identity', name: 'a mismatched proposal digest is ignored', file: ENTRY,
    from: "  if (ref.proposalId !== vm.proposalId\n    || ref.proposalVersion !== vm.proposalVersion\n    || ref.proposalDigest !== vm.proposalDigest) return refuse('identity_mismatch');",
    to: "  if (false) return refuse('identity_mismatch');",
  },
  {
    boundary: 'identity', name: 'invalidation returns the reference intact', file: ENTRY,
    from: 'export function invalidateApprovalRef(): ProfessionalApprovalRef {\n  return { ...INVALIDATED_APPROVAL_REF };\n}',
    to: 'export function invalidateApprovalRef(): ProfessionalApprovalRef {\n  return { ...INVALIDATED_APPROVAL_REF, proposalId: \'d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43\' };\n}',
  },
  {
    boundary: 'identity', name: 'the builder keeps its preview across edits', file: BUILDER,
    from: '    setPreview(null);\n    setPreviewFingerprint(null);',
    to: '    setError(null);',
  },
  {
    boundary: 'identity', name: 'create no longer requires a current preview', file: BUILDER,
    from: '    if (createFlight.current || !previewIsCurrent || !preview) return;',
    to: '    if (createFlight.current) return;',
  },

  // ── 8. APPROVING A MALFORMED / MISMATCHED RESPONSE ───────────────────────
  {
    boundary: 'approval-response', name: 'ok:true taken as approval', file: ENTRY,
    from: '  const vm = parseProfessionalV2ProposalResponse(body, ref.proposalId);\n  if (!vm) return { outcome: \'unverified\' };',
    to: '  const vm = parseProfessionalV2ProposalResponse(body, ref.proposalId);\n  if (!vm) return { outcome: \'confirmed\', vm: body as never };',
  },
  {
    boundary: 'approval-response', name: 'lifecycle not required to read approved', file: ENTRY,
    from: "  if (vm.lifecycle !== 'approved' || !vm.authorization) return { outcome: 'unverified' };",
    to: "  if (false) return { outcome: 'unverified' };",
  },
  {
    boundary: 'approval-response', name: 'the returned digests need not match what was approved', file: ENTRY,
    from: "  if (vm.proposalDigest !== ref.proposalDigest) return { outcome: 'unverified' };\n  if (vm.compiled.graphDigest !== ref.graphDigest) return { outcome: 'unverified' };",
    to: '  if (false) return { outcome: \'unverified\' };',
  },
  {
    boundary: 'approval-response', name: 'an unreadable answer reported as a refusal', file: ENTRY,
    from: "    if (isObject(body) && body.unavailable === true) return { outcome: 'unverified' };",
    to: "    if (isObject(body) && body.unavailable === true) return { outcome: 'refused', code: 'unavailable' };",
  },
  {
    boundary: 'approval-response', name: 'the ceiling need not be confirmed', file: ENTRY,
    from: '  if (input.confirmedMaximumCredits === null\n    || input.confirmedMaximumCredits !== vm.compiled.maximumCredits) return refuse(\'ceiling_not_confirmed\');',
    to: '  if (false) return refuse(\'ceiling_not_confirmed\');',
  },
  {
    boundary: 'approval-response', name: 'the expected spend accepted as the ceiling', file: CARD,
    from: '    confirmedMaximumCredits: confirmedCeiling ? compiled.maximumCredits : null,\n    idempotencyKey: idempotencyKeyRef.current,\n    inFlight: inFlight || settled,',
    to: '    confirmedMaximumCredits: confirmedCeiling ? compiled.initialCredits : null,\n    idempotencyKey: idempotencyKeyRef.current,\n    inFlight: inFlight || settled,',
  },
  {
    boundary: 'approval-response', name: 'single flight removed', file: ENTRY,
    from: "  if (input.inFlight) return refuse('in_flight');",
    to: "  if (false) return refuse('in_flight');",
  },
  {
    boundary: 'approval-response', name: 'a malformed idempotency key is accepted', file: ENTRY,
    from: "  if (!IDEMPOTENCY.test(input.idempotencyKey)) return refuse('invalid_idempotency_key');",
    to: "  if (false) return refuse('invalid_idempotency_key');",
  },

  // ── 9. BYPASSING JWT PROXY AUTHENTICATION ────────────────────────────────
  {
    boundary: 'jwt-proxy', name: 'the upstream call drops the user JWT', file: PROXY,
    from: '        authorization: `Bearer ${session.access_token}`,',
    to: '',
  },
  {
    boundary: 'jwt-proxy', name: 'the signed-out check is removed', file: PROXY,
    from: "  if (!session?.access_token) {\n    return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });\n  }",
    to: '',
  },
  {
    boundary: 'jwt-proxy', name: 'the browser calls the backend directly', file: BUILDER,
    from: "    const res = await fetch('/api/generation-proposals', {",
    to: "    const res = await fetch('https://core.implexa.ai/api/v2/generation-proposals/preview', {",
  },
  {
    boundary: 'jwt-proxy', name: 'the action allowlist becomes a passthrough', file: ACTIONS,
    from: "    case 'preview-professional-v2':\n    case 'create-professional-v2': {\n      const body = professionalV2Input(b);\n      if (typeof body === 'string') return body;",
    to: "    case 'preview-professional-v2':\n    case 'create-professional-v2': {\n      const body = b;\n      if (typeof body === 'string') return body;",
  },

  // ── 10. PROFESSIONAL SELECTABLE WHEN THE BACKEND SAYS UNAVAILABLE ────────
  {
    boundary: 'availability', name: 'the approval gate ignores backend availability', file: ENTRY,
    from: "  if (vm.compiled.availability !== true) return refuse('unavailable');",
    to: "  if (false) return refuse('unavailable');",
  },
  {
    boundary: 'availability', name: 'the card treats every plan as approvable', file: CARD,
    from: '  const previewOnly = compiled.availability !== true;',
    to: '  const previewOnly = false;',
  },
  {
    boundary: 'availability', name: 'an unavailable create is accepted as awaiting approval', file: ENTRY,
    from: "  if (body.state !== (compiled.availability ? 'awaiting_approval' : 'unavailable')) return null;",
    to: '  if (false) return null;',
  },
  {
    boundary: 'availability', name: 'an unavailable document need not say what is missing', file: DOC,
    from: '    if (!isText(v.unavailable_reason)) return null;\n    if (v.required_missing_capabilities.length === 0) return null;',
    to: '    if (!isText(v.unavailable_reason)) return null;',
  },
  {
    boundary: 'availability', name: 'availability may contradict the envelope', file: ENTRY,
    from: '  if (body.availability !== compiled.availability) return false;',
    to: '  if (false) return false;',
  },

  // ── 11. ALTERING EXISTING QUICK / v1 BEHAVIOUR ───────────────────────────
  {
    boundary: 'v1-untouched', name: 'v1 requests gain a control contract version', file: ACTIONS,
    from: "  return {\n    capabilityKey: 'video.generate_broll', qualityMode, agentSubject, sourceRunId,",
    to: "  return {\n    controlContractVersion: CONTROL_V2,\n    capabilityKey: 'video.generate_broll', qualityMode, agentSubject, sourceRunId,",
  },
  {
    boundary: 'v1-untouched', name: 'v1 gains multi-moment submission', file: ACTIONS,
    from: "  if (!Array.isArray(b.moments) || b.moments.length !== 1) return 'Exactly one B-roll moment is required.';",
    to: "  if (!Array.isArray(b.moments) || b.moments.length < 1) return 'Exactly one B-roll moment is required.';",
  },
  {
    boundary: 'v1-untouched', name: 'v1 reads routed through the v2 parser', file: ROUTED,
    from: "  const vm = parseGenerationProposalResponse(body, expectedProposalId);\n  return vm ? { contract: 'v1', vm } : null;",
    to: "  const vm = parseProfessionalV2ProposalResponse(body, expectedProposalId);\n  return vm ? { contract: 'v1', vm } as never : null;",
  },
  {
    boundary: 'v1-untouched', name: 'v2 reads routed through the v1 parser', file: ROUTED,
    from: "  if (route.contract === 'v2') {\n    const vm = parseProfessionalV2ProposalResponse(body, expectedProposalId);\n    return vm ? { contract: 'v2', vm } : null;\n  }",
    to: '',
  },
  {
    boundary: 'v1-untouched', name: 'a v1 document reaching the v2 parser is accepted', file: DOC,
    from: '  if (v.control_contract_version !== CONTROL_V2) return null;',
    to: '  if (false) return null;',
  },

  // ── 12. THE DURABLE EDIT LIFECYCLE ───────────────────────────────────────
  // Both defects this boundary exists for were REAL in the first revision of
  // this PR: Edit navigated to a blank builder (discarding the whole timeline
  // under a label that promised an edit), and the identity was only forgotten in
  // component state, so pressing Back made an abandoned plan approvable again at
  // its old ceiling while the backend still held it awaiting_approval.
  {
    boundary: 'edit-lifecycle', name: 'an approvable plan is edited without being retired', file: ENTRY,
    from: "  return { ok: true, mustRetire: vm.lifecycle === 'awaiting_approval' };",
    to: '  return { ok: true, mustRetire: false };',
  },
  {
    boundary: 'edit-lifecycle', name: 'an already-approved plan is editable', file: ENTRY,
    from: "  if (vm.lifecycle === 'approved') {\n    return { ok: false, reason: 'This plan is already approved, so it cannot be edited. Build a new plan instead.' };\n  }",
    to: '',
  },
  {
    boundary: 'edit-lifecycle', name: 'retirement claimed on a bare ok:true', file: ENTRY,
    from: "  const vm = parseProfessionalV2ProposalResponse(body, proposalId);\n  if (!vm) return 'unverified';\n  return vm.lifecycle === 'cancelled' ? 'cancelled' : 'unverified';",
    to: "  return 'cancelled';",
  },
  {
    boundary: 'edit-lifecycle', name: 'a still-approvable read counted as retired', file: ENTRY,
    from: "  return vm.lifecycle === 'cancelled' ? 'cancelled' : 'unverified';",
    to: "  return 'cancelled';",
  },
  {
    boundary: 'edit-lifecycle', name: 'an unreadable cancel answer reported as a refusal', file: ENTRY,
    from: "  if (!httpOk) {\n    if (isObject(body) && body.unavailable === true) return 'unverified';\n    if (isObject(body) && typeof body.error === 'string' && body.error) return 'refused';\n    return 'unverified';\n  }\n  const vm = parseProfessionalV2ProposalResponse(body, proposalId);",
    to: "  if (!httpOk) {\n    return 'refused';\n  }\n  const vm = parseProfessionalV2ProposalResponse(body, proposalId);",
  },
  {
    boundary: 'edit-lifecycle', name: 'the editor opens even when retirement failed', file: CARD,
    from: "      if (outcome !== 'cancelled') {",
    to: '      if (false) {',
  },
  {
    boundary: 'edit-lifecycle', name: 'Edit discards the plan instead of carrying it', file: PAGE,
    from: '          editHref={read.vm.sourceRunId\n            ? `/runs/${encodeURIComponent(read.vm.sourceRunId)}/generate-broll?from=${encodeURIComponent(read.vm.proposalId)}`\n            : null}',
    to: '          editHref={read.vm.sourceRunId\n            ? `/runs/${encodeURIComponent(read.vm.sourceRunId)}/generate-broll`\n            : null}',
  },
  {
    boundary: 'edit-lifecycle', name: 'the seed is not bound to this run', file: ENTRY_PAGE,
    from: '  if (read.vm.sourceRunId !== runId) return null;',
    to: '  if (false) return null;',
  },
  {
    boundary: 'edit-lifecycle', name: 'a v1 proposal seeds the Professional editor', file: ENTRY_PAGE,
    from: "  if (read.state !== 'ready' || read.contract !== 'v2') return null;",
    to: "  if (read.state !== 'ready') return null;",
  },
  {
    boundary: 'edit-lifecycle', name: 'a failed edit load opens a blank builder silently', file: ENTRY_PAGE,
    from: '  const editRequestedButUnavailable = !!searchParams?.from && seedMoments === null;',
    to: '  const editRequestedButUnavailable = false;',
  },
  {
    boundary: 'edit-lifecycle', name: 'a seeded timeline is not validated before it is offered', file: ENTRY,
    from: '  return validateTimeline(moments).ok ? moments : null;',
    to: '  return moments;',
  },
  {
    boundary: 'edit-lifecycle', name: 'the seed loses a moment field', file: ENTRY,
    from: '    variantsRequested: moment.variantsRequested,\n    judgeMode: moment.judgeMode,\n    maxRepairs: moment.maxRepairs,\n  }));\n  return validateTimeline(moments).ok ? moments : null;',
    to: '    variantsRequested: 1,\n    judgeMode: moment.judgeMode,\n    maxRepairs: moment.maxRepairs,\n  }));\n  return validateTimeline(moments).ok ? moments : null;',
  },
  {
    boundary: 'edit-lifecycle', name: 'a seeded edit lands on the Quick lane, hiding the plan', file: ENTRY_BUILDER,
    from: "  const [lane, setLane] = useState<EntryLane>(seedMoments && seedMoments.length ? 'professional' : 'quick');",
    to: "  const [lane, setLane] = useState<EntryLane>('quick');",
  },
  {
    boundary: 'edit-lifecycle', name: 'the seeded plan is dropped on the way to the builder', file: BUILDER,
    from: '  const [moments, setMoments] = useState<TimelineMoment[]>(\n    seedMoments && seedMoments.length ? seedMoments : [newMoment(1, 0)],\n  );',
    to: '  const [moments, setMoments] = useState<TimelineMoment[]>([newMoment(1, 0)]);',
  },

  // ── extra boundaries the lane also depends on ────────────────────────────
  {
    boundary: 'bounds', name: 'the whole-graph task ceiling is dropped', file: TIMELINE,
    from: '  if (priceable && totalTaskCount > BOUNDS.maxTotalTasks) {',
    to: '  if (false) {',
  },
  {
    boundary: 'bounds', name: 'variant bounds widened past the Professional policy', file: TIMELINE,
    from: '      || moment.variantsRequested > BOUNDS.maxVariantsPerMoment) {',
    to: '      || moment.variantsRequested > 6) {',
  },
  {
    boundary: 'bounds', name: 'the prompt ceiling ignores the derived suffix', file: 'lib/professional-v2-contract.ts',
    from: '  return Math.min(BOUNDS.promptMaxChars, providerRoom);',
    to: '  return providerRoom;',
  },
  {
    boundary: 'bounds', name: 'a moment need not be the duration its window implies', file: DOC,
    from: '    if (raw.duration_seconds !== durationSecondsFor(startMs, endMs)) return null;',
    to: '    if (false) return null;',
  },
  {
    boundary: 'bounds', name: 'the moment-id grammar is widened', file: 'lib/professional-v2-contract.ts',
    from: 'export const MOMENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;',
    to: 'export const MOMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;',
  },
];

let killed = 0;

for (const mutation of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-professional-v2-mutant-'));
  try {
    for (const file of FILES) {
      const target = join(dir, file);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, file), target);
    }
    const target = join(dir, mutation.file);
    const source = readFileSync(target, 'utf8');
    if (!source.includes(mutation.from)) throw new Error(`Mutation anchor missing: ${mutation.name} (${mutation.file})`);
    writeFileSync(target, source.replace(mutation.from, mutation.to));

    const result = spawnSync(
      process.execPath,
      ['--test', ...SUITES.map((suite) => join(dir, suite))],
      { cwd: dir, encoding: 'utf8', env: process.env },
    );
    // A SURVIVOR IS A HARD FAILURE. There is no declared-survivor escape hatch:
    // if a mutation of this surface does not fail a test, the guard it broke is
    // not actually guarded, and that must stop the harness rather than be noted.
    if (result.status === 0) {
      process.stderr.write(result.stdout.slice(-4000));
      process.stderr.write(result.stderr.slice(-2000));
      throw new Error(`SURVIVED [${mutation.boundary}] ${mutation.name}`);
    }
    killed += 1;
    console.log(`KILLED [${mutation.boundary}] ${mutation.name}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const boundaries = new Set(mutations.map((m) => m.boundary));
console.log(`\nMutation result: ${killed}/${mutations.length} killed across ${boundaries.size} boundaries.`);
