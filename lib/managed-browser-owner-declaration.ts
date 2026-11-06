// Extends Agent Setup's existing native bridge. No direct backend mutation,
// credential storage, retry authority, qualification or trial consent lives here.
export type OwnerTarget = { accountId: string; slug: string; versionId: string };
export type OwnerView = {
  contractVersion: 'managed-browser-no-spend-owner-view.v1';
  state: 'absent' | 'declared_unverified' | 'expired' | 'mismatch';
  grantId: string; workflowVersionId: string; machineId: string; profileId: string; bindingId: string;
  expectedDeclarationDigest: string | null; origins: string[]; purpose?: 'owner_revoke';
  declaration: null | { statement: string; status: string; declaredAt: string; expiresAt: string; origins: string[]; evidenceRef: string | null };
};
export type OwnerDecision = {
  contractVersion: 'managed-browser-no-spend-update.v1'; grantId: string; workflowVersionId: string;
  machineId: string; profileId: string; bindingId: string; expectedDeclarationDigest: string | null;
  operation: 'declare' | 'revoke'; statement: 'no_payment_method_free_plan' | null;
  expiresAt: string | null; evidenceRef: string | null;
};
export type OwnerBridge = {
  managedBrowserNoSpendContext?: (target: OwnerTarget & { operation?: 'revoke' }) => Promise<unknown>;
  confirmManagedBrowserNoSpend?: (input: { slug: string; versionId: string; decision: OwnerDecision; decisionDigest: string; ownerSessionToken: string }) => Promise<unknown>;
};
type OwnerSession = { user: { id: string }; access_token: string };
export type OwnerOperationContext = {
  target: OwnerTarget; bridge: OwnerBridge; getSession: () => Promise<OwnerSession | null>; current: () => boolean;
};
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const originList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(origin => {
  if (typeof origin !== 'string') return false;
  try { return new URL(origin).protocol === 'https:' && new URL(origin).origin === origin; } catch { return false; }
});

export function readOwnerView(value: unknown, target: OwnerTarget, operation: 'declare' | 'revoke'): OwnerView {
  const keys = ['contractVersion', 'state', 'grantId', 'workflowVersionId', 'machineId', 'profileId', 'bindingId', 'expectedDeclarationDigest', 'origins', 'declaration'];
  if (!record(value) || !exact(value, operation === 'revoke' ? [...keys, 'purpose'] : keys)
    || value.contractVersion !== 'managed-browser-no-spend-owner-view.v1'
    || !['absent', 'declared_unverified', 'expired', 'mismatch'].includes(value.state)
    || value.workflowVersionId !== target.versionId || ![value.grantId, value.workflowVersionId, value.profileId, value.bindingId].every(uuid)
    || typeof value.machineId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(value.machineId)
    || value.expectedDeclarationDigest !== null && !/^[a-f0-9]{64}$/.test(value.expectedDeclarationDigest)
    || !originList(value.origins) || operation === 'revoke' && value.purpose !== 'owner_revoke') throw Error('Account statement unavailable. Review it again.');
  const d = value.declaration;
  if (d !== null && (!record(d) || !exact(d, ['statement', 'status', 'declaredAt', 'expiresAt', 'origins', 'evidenceRef'])
    || d.statement !== 'no_payment_method_free_plan' || d.status !== 'owner_declared_unverified'
    || typeof d.declaredAt !== 'string' || !Number.isFinite(Date.parse(d.declaredAt))
    || typeof d.expiresAt !== 'string' || !Number.isFinite(Date.parse(d.expiresAt))
    || !originList(d.origins) || d.evidenceRef !== null && (typeof d.evidenceRef !== 'string' || d.evidenceRef.length > 1024)))
    throw Error('Account statement unavailable. Review it again.');
  if ((d === null) !== (value.expectedDeclarationDigest === null) || operation === 'revoke' && d === null)
    throw Error('No saved statement is available to revoke.');
  return JSON.parse(JSON.stringify(value)) as OwnerView;
}

async function currentOwner(ctx: OwnerOperationContext, requireToken = false) {
  if (!ctx.current()) throw Error('Account or Agent changed. Review it again.');
  const session = await ctx.getSession();
  if (!ctx.current() || session?.user.id !== ctx.target.accountId || requireToken && !session.access_token)
    throw Error('Account or Agent changed. Review it again.');
  return session;
}

export async function loadOwnerView(ctx: OwnerOperationContext, operation: 'declare' | 'revoke') {
  if (!ctx.bridge.managedBrowserNoSpendContext) throw Error('Open this Agent in an updated Implexa app.');
  await currentOwner(ctx);
  const response = await ctx.bridge.managedBrowserNoSpendContext({ ...ctx.target, ...(operation === 'revoke' ? { operation: 'revoke' as const } : {}) });
  await currentOwner(ctx);
  if (!record(response) || response.ok !== true) throw Error('Account statement unavailable. Review it again.');
  return readOwnerView(response.context, ctx.target, operation);
}

export function ownerDecision(view: OwnerView, operation: 'declare' | 'revoke', options: { confirmed?: boolean; expiresAt?: string; evidenceRef?: string } = {}, now = Date.now()): OwnerDecision {
  // The owner sees these values before confirming. Never replace the view with
  // a fresh one under an already confirmed decision; Main performs its own CAS.
  if (operation === 'declare' && (view.purpose !== undefined || view.state === 'mismatch' || options.confirmed !== true
    || !options.expiresAt || !Number.isFinite(Date.parse(options.expiresAt)) || Date.parse(options.expiresAt) <= now
    || Date.parse(options.expiresAt) - now > 30 * 86400000 || (options.evidenceRef?.length || 0) > 1024))
    throw Error('Confirm the statement and choose a future expiry within 30 days.');
  if (operation === 'revoke' && (view.purpose !== 'owner_revoke' || !view.declaration)) throw Error('Review the saved statement before revoking it.');
  return Object.freeze({ contractVersion: 'managed-browser-no-spend-update.v1', grantId: view.grantId,
    workflowVersionId: view.workflowVersionId, machineId: view.machineId, profileId: view.profileId, bindingId: view.bindingId,
    expectedDeclarationDigest: view.expectedDeclarationDigest, operation,
    statement: operation === 'declare' ? 'no_payment_method_free_plan' : null,
    expiresAt: operation === 'declare' ? options.expiresAt! : null,
    evidenceRef: operation === 'declare' ? options.evidenceRef || null : null });
}

export async function ownerDecisionDigest(decision: OwnerDecision): Promise<string> {
  // This exact wire is flat: every value is a string or null. Sorted keys thus
  // produce the same canonical bytes as Main/backend, without a second general serializer.
  if (Object.values(decision).some(value => value !== null && typeof value !== 'string')) throw Error('Invalid confirmed decision.');
  const text = JSON.stringify(Object.fromEntries(Object.keys(decision).sort().map(key => [key, decision[key as keyof OwnerDecision]])));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function confirmOwnerDecision(ctx: OwnerOperationContext, decision: OwnerDecision) {
  if (!ctx.bridge.confirmManagedBrowserNoSpend) throw Error('Open this Agent in an updated Implexa app.');
  const decisionDigest = await ownerDecisionDigest(decision);
  let session: OwnerSession | null = await currentOwner(ctx, true);
  try {
    const response = await ctx.bridge.confirmManagedBrowserNoSpend({ slug: ctx.target.slug, versionId: ctx.target.versionId,
      decision, decisionDigest, ownerSessionToken: session!.access_token });
    await currentOwner(ctx);
    if (!record(response) || response.ok !== true) throw Error('Confirmation unavailable.');
  } finally { session = null; }
  // No catch/retry: an unknown acknowledgement must be resolved with a new read.
}
