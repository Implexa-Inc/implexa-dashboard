#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const componentPath = 'app/(dashboard)/training/[slug]/training-source.tsx';
const helperPath = 'lib/training-local-ingress.ts';
const testPath = 'app/(dashboard)/training/[slug]/training-source.test.ts';
const originals = new Map([
  [componentPath, readFileSync(resolve(root, componentPath), 'utf8')],
  [helperPath, readFileSync(resolve(root, helperPath), 'utf8')],
]);

const mutations = [
  ['bridge-version', helperPath, "export const TRAINING_LOCAL_CONTRACT_VERSION = '2';", "export const TRAINING_LOCAL_CONTRACT_VERSION = '1';"],
  ['routing-version', helperPath, "export const TRAINING_STAGE_ROUTING_VERSION = 'manager-training-applicability.v1';", "export const TRAINING_STAGE_ROUTING_VERSION = 'manager-training-applicability.v0';"],
  ['planning-default', helperPath, "const commonCreativeStages: TrainingStage[] = ['planning', 'build', 'preview', 'qa', 'revision'];", "const commonCreativeStages: TrainingStage[] = ['build', 'preview', 'qa', 'revision'];"],
  ['scene-contract-default', helperPath, "if (sceneContractProperties.has(property)) stages.splice(1, 0, 'scene_contract');", "if (false) stages.splice(1, 0, 'scene_contract');"],
  ['stage-canonical-order', helperPath, "TRAINING_STAGE_OPTIONS.map(({ value }) => value).filter((stage) => selected.has(stage));", "[...selected].filter((stage): stage is TrainingStage => true);"],
  ['preview-source', helperPath, 'preview.token === sourceToken && preview.timeMs === timeMs', 'true && preview.timeMs === timeMs'],
  ['preview-time', helperPath, 'preview.token === sourceToken && preview.timeMs === timeMs', 'preview.token === sourceToken'],
  ['successor-projection-shape', helperPath, "!exact(value, ['contractVersion', 'activeVersionId', 'eligiblePredecessor'])", 'false'],
  ['successor-projection-contract', helperPath, "value.contractVersion !== 'agent-training-successor-projection.v1'", 'false'],
  ['successor-projection-active-version', helperPath, 'value.activeVersionId !== currentVersionId', 'false'],
  ['successor-projection-predecessor-shape', helperPath, "exact(predecessor, ['sessionId', 'baseVersionId', 'acceptedLocalRecordCount'])", 'true'],
  ['successor-projection-distinct-version', helperPath, 'predecessor.baseVersionId !== value.activeVersionId', 'true'],
  ['successor-projection-accepted-count', helperPath, 'Number(predecessor.acceptedLocalRecordCount) > 0', 'true'],
  ['requirements-version', helperPath, "value.contractVersion !== 'manager-reference-training-readiness.v1' || value.scope !== 'workflow_version_quality_references'\n    || value.workflowVersionId !== workflowVersionId", "value.contractVersion !== 'manager-reference-training-readiness.v1' || value.scope !== 'workflow_version_quality_references'\n    || false"],
  ['requirements-partition', helperPath, 'fulfilled.some((key) => missingSet.has(key))', 'false'],
  ['requirements-stage-match', helperPath, '.filter((pair) => pair.property === property && pair.relation === relation).map((pair) => pair.stage)', '.map((pair) => pair.stage)'],
  ['version-drift', componentPath, 'result.scope.session.baseVersionId !== result.scope.agent.currentVersionId', 'false'],
  ['decision-digest', componentPath, 'result.recordId !== decision.recordId || result.recordDigest !== decision.recordDigest || !result.image', 'result.recordId !== decision.recordId || !result.image'],
  ['accept-confirmation', componentPath, 'disabled={!!busy || !acceptConfirmed} onClick={acceptReviewed}', 'disabled={!!busy} onClick={acceptReviewed}'],
  ['revoke-confirmation', componentPath, 'disabled={!!busy || !revokeConfirmed} onClick={revokeReviewed}', 'disabled={!!busy} onClick={revokeReviewed}'],
  ['source-retryability', componentPath, "{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying registration'", "{true ? <button disabled={!!busy} onClick={() => work('Retrying registration'"],
  ['decision-retryability', componentPath, "{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying saved decision'", "{true ? <button disabled={!!busy} onClick={() => work('Retrying saved decision'"],
  ['single-use-preview', componentPath, 'setDecisionKey(crypto.randomUUID()); setPreview(null); setChosen(\'\');', 'setDecisionKey(crypto.randomUUID()); setChosen(\'\');'],
  ['accept-digest-wire', componentPath, "await call('accept', { token: reviewed.source.token, recordId: reviewed.decision.recordId, expectedDigest: reviewed.decision.recordDigest });", "await call('accept', { token: reviewed.source.token, recordId: reviewed.decision.recordId });"],
  ['accessible-time', componentPath, 'aria-valuetext={formatTrainingTime(time)}', 'aria-label="timestamp"'],
  ['version-negotiation', componentPath, "if (candidate.trainingLocalContractVersion !== TRAINING_LOCAL_CONTRACT_VERSION) {", 'if (false) {'],
  ['stage-wire', componentPath, 'applicability: { taskFacts: [], stages: normalizeTrainingStages(stages), exceptions: [], priority: 50 },', "applicability: { taskFacts: [], stages: ['preview'], exceptions: [], priority: 50 },"],
  ['empty-stage-gate', componentPath, 'stages.length === 0 ||', 'false ||'],
  ['coverage-exact-shape', helperPath, "!workflowVersionId || !exact(value, ['contractVersion', 'scope', 'workflowVersionId', 'classified',\n    'acceptedLocalRecordCount'", "!workflowVersionId || false || (value as any).extra === true || !exact(value, ['contractVersion', 'scope', 'workflowVersionId', 'classified',\n    'acceptedLocalRecordCount'"],
  ['coverage-identity-gate', helperPath, "value.contractVersion !== 'manager-training-coverage.v1' || value.scope !== 'workflow_version'\n    || value.workflowVersionId !== workflowVersionId", "value.contractVersion !== 'manager-training-coverage.v1' || value.scope !== 'workflow_version'\n    || false"],
  ['coverage-scope-gate', helperPath, "value.contractVersion !== 'manager-training-coverage.v1' || value.scope !== 'workflow_version'", "value.contractVersion !== 'manager-training-coverage.v1' || false"],
  ['coverage-session-count-gate', componentPath, "managerCoverage.listedSessionAcceptedRecordCount === acceptedEvidenceCount", 'true'],
  ['coverage-global-count-gate', helperPath, 'Number(value.listedSessionAcceptedRecordCount) > Number(value.acceptedLocalRecordCount)', 'false'],
  ['coverage-zero-count-pair-gate', helperPath, "if (Number(value.acceptedLocalRecordCount) === 0) return value.readiness === 'not_applicable' && value.reason === null\n    && accepted.length === 0 && listed.length === 0 && covered.length === 0 && uncovered.length === 0;", "if (value.readiness === 'not_applicable') return value.reason === null\n    && accepted.length === 0 && listed.length === 0 && covered.length === 0 && uncovered.length === 0;"],
  ['coverage-positive-count-pair-gate', helperPath, 'if (accepted.length === 0) return false;', 'if (false) return false;'],
  ['coverage-classified-gate', helperPath, "if (value.readiness === 'ready') return value.classified && value.reason === null", "if (value.readiness === 'ready') return true && value.reason === null"],
  ['coverage-pair-gate', helperPath, "if (covered.some((key) => uncoveredSet.has(key)) || [...covered, ...uncovered].some((key) => !acceptedSet.has(key))\n    || accepted.some((key) => !coveredSet.has(key) && !uncoveredSet.has(key))) return false;", 'if (false) return false;'],
  ['coverage-property-enum', helperPath, "typeof pair.property !== 'string' || !PROPERTY_CODES.has(pair.property)", "typeof pair.property !== 'string'"],
  ['coverage-relation-enum', helperPath, "typeof pair.relation !== 'string' || !RELATIONS.has(pair.relation)", "typeof pair.relation !== 'string'"],
  ['authoring-exception-relation', helperPath, "export const TRAINING_RELATIONS = ['accepted', 'rejected', 'contrast', 'exception'] as const;", "export const TRAINING_RELATIONS = ['accepted', 'rejected', 'contrast'] as const;"],
  ['authoring-full-property-set', helperPath, "'flicker_exclusion', 'repeated_template_avoidance', 'sparse_motion_avoidance',", "'flicker_exclusion', 'repeated_template_avoidance',"],
  ['requirements-ready-gate', componentPath, 'coverageCanClaimReady && trainingIsReady && managerTrainingRequirements', 'coverageCanClaimReady && managerTrainingRequirements'],
  ['successor-preserves-stages', componentPath, 'setStages(preserved);', 'setStages(required);'],
  ['successor-expansion-action', componentPath, 'onClick={addRequiredSuccessorStages}', 'onClick={() => {}}'],
  ['successor-repreview', componentPath, "function createPlanningSuccessor(source: Source, decision: Decision) {\n    const nextProperty = decision.content.properties[0] || 'motion_rhythm';\n    setSelected(source); setTime(decision.content.anchor.startMs); setPreview(null); setReviewed(null);", "function createPlanningSuccessor(source: Source, decision: Decision) {\n    const nextProperty = decision.content.properties[0] || 'motion_rhythm';\n    setSelected(source); setTime(decision.content.anchor.startMs); setPreview({ token: source.token!, timeMs: decision.content.anchor.startMs, image: 'stale' }); setReviewed(null);"],
  ['version-successor-confirmation', componentPath, 'disabled={!!busy || !transitionConfirmed || !currentVersion} onClick={beginVersionSuccessor}', 'disabled={!!busy || !currentVersion} onClick={beginVersionSuccessor}'],
  ['version-successor-stable-idempotency', componentPath, "const [successorSessionKey] = useState(() => crypto.randomUUID());", "const successorSessionKey = crypto.randomUUID();"],
  ['version-successor-server-projection', componentPath, 'const predecessor = projection.eligiblePredecessor;', 'const predecessor = null;'],
  ['version-successor-reload-lineage', componentPath, 'if (!predecessor || scoped.scope.session.parentSessionId === predecessor.sessionId)', 'if (!predecessor || true)'],
  ['version-successor-reload-fallback', componentPath, '} else if (predecessor) {', '} else if (false) {'],
  ['version-successor-binding', componentPath, '|| scoped.scope.session.baseVersionId !== active.scope.agent.currentVersionId', '|| false'],
  ['version-successor-lineage', componentPath, 'created.parentSessionId !== predecessorSessionId || created.baseVersionId !== active.scope.agent.currentVersionId', 'false'],
  ['version-successor-source-hash', componentPath, 'sources.find((candidate) => candidate.metadata.sha256 === oldSource.metadata.sha256)', 'sources[0]'],
  ['version-successor-repreview', componentPath, "function prepareVersionSuccessor(source: Source, decision: Decision) {\n    const nextProperty = decision.content.properties[0] || 'motion_rhythm';\n    setSelected(source); setTime(decision.content.anchor.startMs); setPreview(null); setReviewed(null);", "function prepareVersionSuccessor(source: Source, decision: Decision) {\n    const nextProperty = decision.content.properties[0] || 'motion_rhythm';\n    setSelected(source); setTime(decision.content.anchor.startMs); setPreview({ token: source.token!, timeMs: decision.content.anchor.startMs, image: 'stale' }); setReviewed(null);"],
];

const stale = mutations.filter(([, file, from]) => originals.get(file).split(from).length !== 2);
if (stale.length) {
  console.error(`Mutation anchors must occur exactly once:\n${stale.map(([name]) => `  ${name}`).join('\n')}`);
  process.exit(1);
}

let killed = 0;
const survivors = [];
try {
  for (const [name, file, from, to] of mutations) {
    const target = resolve(root, file);
    writeFileSync(target, originals.get(file).replace(from, to));
    const result = spawnSync(process.execPath, ['scripts/run-listed-tests.mjs', testPath], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    if (result.status === 0) { survivors.push(name); console.log(`SURVIVED: ${name}`); }
    else { killed += 1; console.log(`KILLED: ${name}`); }
    writeFileSync(target, originals.get(file));
  }
} finally {
  for (const [file, original] of originals) writeFileSync(resolve(root, file), original);
}

console.log(`Training local ingress mutations: ${killed}/${mutations.length} killed`);
if (survivors.length) {
  console.error(`Survivors: ${survivors.join(', ')}`);
  process.exit(1);
}
