// A one-request exception to prior qualification, not qualification evidence.
// Extends the existing Run form and owner request endpoint; never queues itself.
import type { OwnerTarget } from './managed-browser-owner-declaration';
export type TrialRuntimeBridge = { managedBrowserTrialRuntime?: (target: OwnerTarget) => Promise<unknown> };
export type TrialDecision = Record<string, string | number> & { requestId: string; expiresAt: string; maxAttempts: 1 };
export type PreparedOwnerTrial = { target: OwnerTarget; runtime: Record<string, any>; decision: TrialDecision;
  decisionDigest: string; origins: string[]; requestBody: Record<string, any>; requestBodyDigest: string };
type Session = { user: { id: string }; access_token: string };
type TrialContext = { target: OwnerTarget; bridge: TrialRuntimeBridge; getSession: () => Promise<Session | null>;
  current: () => boolean; callBackend: (path: string, options: any) => Promise<any> };
const keys = ['contractVersion', 'status', 'requestId', 'ownerId', 'organizationId', 'workflowId', 'workflowVersionId',
  'hardeningRecordId', 'definitionDigest', 'grantId', 'permissionGrantDigest', 'declarationDigest', 'machineId',
  'profileId', 'bindingId', 'executor', 'expectedPolicyDigest', 'expectedCatalogDigest', 'inputBindingsDigest',
  'runtimeIdentityDigest', 'maxAttempts', 'expiresAt'];
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value: any): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
async function textDigest(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function trialDecisionDigest(decision: TrialDecision) {
  if (Object.keys(decision).sort().join(',') !== [...keys].sort().join(',') || decision.maxAttempts !== 1
    || Object.entries(decision).some(([key, value]) => key !== 'maxAttempts' && typeof value !== 'string')) throw Error('Trial decision unavailable.');
  const text = JSON.stringify(Object.fromEntries(Object.keys(decision).sort().map(key => [key, decision[key]])));
  return textDigest(text);
}
async function owner(ctx: TrialContext) {
  if (!ctx.current()) throw Error('Account or Agent changed.');
  const session = await ctx.getSession();
  if (!ctx.current() || session?.user.id !== ctx.target.accountId || !session.access_token) throw Error('Sign in to the same Dashboard account again.');
  return session;
}
export async function prepareOwnerTrial(ctx: TrialContext, requestBody: Record<string, any>, expiresAt: string): Promise<PreparedOwnerTrial> {
  if (!ctx.bridge.managedBrowserTrialRuntime || requestBody.kind !== 'run' || requestBody.source !== 'dashboard'
    || requestBody.workflowSlug !== ctx.target.slug || requestBody.workflowVersionId !== ctx.target.versionId
    || !record(requestBody.inputBindings) || requestBody.deferredInputManifest || requestBody.trainingTest
    || requestBody.runId || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()
    || Date.parse(expiresAt) - Date.now() > 24 * 3600000) throw Error('Register the selected inputs and choose a trial expiry within 24 hours.');
  await owner(ctx);
  const runtime = await ctx.bridge.managedBrowserTrialRuntime(ctx.target);
  await owner(ctx);
  if (!record(runtime) || runtime.ok !== true || runtime.contractVersion !== 'managed-browser-trial-runtime-view.v1'
    || runtime.workflowVersionId !== ctx.target.versionId || !hash(runtime.runtimeIdentityDigest)
    || typeof runtime.machineId !== 'string' || typeof runtime.profileId !== 'string' || typeof runtime.bindingId !== 'string'
    || !record(runtime.versions) || Object.values(runtime.versions).some(value => typeof value !== 'string' || value.length > 200)
    || requestBody.executionMachineId && requestBody.executionMachineId !== runtime.machineId
    || requestBody.requiredMachineId && requestBody.requiredMachineId !== runtime.machineId) throw Error('The selected machine or browser changed. Review setup again.');
  const body = JSON.parse(JSON.stringify({ ...requestBody, executionMachineId: runtime.machineId, requiredMachineId: runtime.machineId }));
  const requestId = crypto.randomUUID();
  const session = await owner(ctx);
  const preview = await ctx.callBackend('/api/v2/me/run-requests/managed-browser-trial-context', { jwt: session.access_token, method: 'POST', body: {
    workflowSlug: ctx.target.slug, requestId, workflowVersionId: ctx.target.versionId,
    machineId: runtime.machineId, runtimeIdentityDigest: runtime.runtimeIdentityDigest, expiresAt, inputBindings: body.inputBindings,
  } });
  await owner(ctx);
  const d = preview?.decision;
  if (preview?.ok !== true || preview.contractVersion !== 'managed-browser-action-trial-context.v1' || !record(d)
    || d.contractVersion !== 'managed-browser-action-trial-decision.v1' || d.status !== 'trial_unqualified'
    || d.requestId !== requestId || d.ownerId !== ctx.target.accountId || d.workflowVersionId !== ctx.target.versionId || d.executor !== 'codex'
    || d.maxAttempts !== 1 || d.expiresAt !== expiresAt || d.machineId !== runtime.machineId
    || d.profileId !== runtime.profileId || d.bindingId !== runtime.bindingId || d.runtimeIdentityDigest !== runtime.runtimeIdentityDigest
    || !Array.isArray(preview.origins) || !preview.origins.length || preview.origins.some((value: any) => typeof value !== 'string')
    || !hash(preview.decisionDigest) || await trialDecisionDigest(d as TrialDecision) !== preview.decisionDigest) throw Error('Trial context changed. Review it again.');
  const requestBodyDigest = await textDigest(JSON.stringify(body));
  await owner(ctx);
  return { target: { ...ctx.target }, runtime, decision: Object.freeze({ ...d }) as TrialDecision,
    decisionDigest: preview.decisionDigest, origins: [...preview.origins], requestBody: body, requestBodyDigest };
}
export async function submitOwnerTrial(ctx: TrialContext, prepared: PreparedOwnerTrial) {
  if (prepared.target.accountId !== ctx.target.accountId || prepared.target.slug !== ctx.target.slug
    || prepared.target.versionId !== ctx.target.versionId || await trialDecisionDigest(prepared.decision) !== prepared.decisionDigest
    || await textDigest(JSON.stringify(prepared.requestBody)) !== prepared.requestBodyDigest)
    throw Error('The confirmed trial changed.');
  if (Date.parse(prepared.decision.expiresAt) <= Date.now()) throw Error('This trial authorization expired. Review a fresh trial before starting.');
  let session: Session | null = await owner(ctx);
  try {
    // One request POST only. Caller must never treat a lost reply as permission
    // to create a replacement or reuse this confirmed authorization.
    const result = await ctx.callBackend('/api/v2/me/run-requests', { jwt: session.access_token, method: 'POST',
      body: { ...prepared.requestBody, managedBrowserTrial: { decision: prepared.decision, decisionDigest: prepared.decisionDigest } } });
    await owner(ctx);
    if (result?.ok !== true || result.request?.id !== prepared.decision.requestId) throw Error('Trial receipt unavailable.');
    return result;
  } catch (error) {
    const typed = error as { status?: number; body?: Record<string, any> };
    // Only explicit no-request refusals are safe to present as such. A lost
    // response, service error or issuer ambiguity may follow a durable insert.
    if (typed?.status === 409 && (record(typed.body?.setupRequired) || record(typed.body?.needsCapability))
      || typed?.status === 400 && (typed.body?.reason === 'managed_browser_trial_invalid' || typed.body?.code === 'managed_browser_trial_invalid')) throw error;
    throw Error(`The result for trial ${prepared.decision.requestId} could not be confirmed. Check that request before any new test.`);
  } finally { session = null; }
}
