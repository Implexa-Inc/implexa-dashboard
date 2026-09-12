const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ACTION_RE = /^[a-z][a-z0-9_.-]{0,99}$/;
const REQUEST_REF_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const OUTPUT_RELATIVE_PATH_RE = /^public\/media\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.mp4$/;
const EXECUTABLE_RESOLUTIONS = new Set(['1920x1080', '1080p', '1080x1920', '1080x1080']);

export type PaidActionInput = {
  semanticKey: string;
  displayName: string;
  artifactId: string;
  sha256: string;
};

export type PaidActionRequest = {
  requestId: string;
  sceneId: string;
  prompt: string;
  sourceRange: { startFrame: number; endFrame: number };
  model: string;
  resolution: string;
  durationSeconds: number;
  estimatedCost: number;
  intendedUse: string;
  outputRelativePath: string;
};

export type PaidActionApprovalSummary = {
  contractVersion: 'paid-action-approval-summary.v3';
  approvalIntentId: string;
  requestManifestArtifactId: string;
  requestManifestDigest: string;
  provider: string;
  operation: string;
  requestCount: number;
  estimatedCost: number;
  currency: 'USD' | 'credits';
  inputs: PaidActionInput[];
  requests: PaidActionRequest[];
};

export type PaidActionApprovalView =
  | { state: 'ready'; summary: PaidActionApprovalSummary }
  | { state: 'agent_update_required'; reason: 'paid_action_manifest_v3_required' }
  | { state: 'unavailable'; reason: 'missing' | 'malformed' | 'request_failed' };

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function parsePaidActionApprovalSummary(value: unknown): PaidActionApprovalSummary | null {
  const summaryKeys = ['contractVersion', 'approvalIntentId', 'requestManifestArtifactId', 'requestManifestDigest',
    'provider', 'operation', 'requestCount', 'estimatedCost', 'currency', 'inputs', 'requests'] as const;
  if (!exactKeys(value, summaryKeys)
    || value.contractVersion !== 'paid-action-approval-summary.v3'
    || typeof value.approvalIntentId !== 'string' || !UUID_RE.test(value.approvalIntentId)
    || typeof value.requestManifestArtifactId !== 'string' || !UUID_RE.test(value.requestManifestArtifactId)
    || typeof value.requestManifestDigest !== 'string' || !SHA256_RE.test(value.requestManifestDigest)
    || value.provider !== 'higgsfield' || value.operation !== 'kling3_0.video_generation'
    || !Number.isInteger(value.requestCount) || (value.requestCount as number) < 1 || (value.requestCount as number) > 100
    || !finite(value.estimatedCost) || value.estimatedCost < 0 || value.estimatedCost > 10_000_000
    || Number(value.estimatedCost.toFixed(6)) !== value.estimatedCost
    || (value.currency !== 'USD' && value.currency !== 'credits')
    || !Array.isArray(value.inputs) || value.inputs.length < 1 || value.inputs.length > 16
    || !Array.isArray(value.requests) || value.requests.length !== value.requestCount) return null;

  const inputKeys = ['semanticKey', 'displayName', 'artifactId', 'sha256'] as const;
  const semanticKeys = new Set<string>();
  for (const input of value.inputs) {
    if (!exactKeys(input, inputKeys)
      || typeof input.semanticKey !== 'string' || !ACTION_RE.test(input.semanticKey) || semanticKeys.has(input.semanticKey)
      || typeof input.displayName !== 'string' || input.displayName.length < 1 || input.displayName.length > 255
      || /[\\/\r\n]/.test(input.displayName)
      || typeof input.artifactId !== 'string' || !UUID_RE.test(input.artifactId)
      || typeof input.sha256 !== 'string' || !SHA256_RE.test(input.sha256)) return null;
    semanticKeys.add(input.semanticKey);
  }
  if (!semanticKeys.has('project_bundle') || !semanticKeys.has('presenter_video')) return null;

  const requestKeys = ['requestId', 'sceneId', 'prompt', 'sourceRange', 'model', 'resolution',
    'durationSeconds', 'estimatedCost', 'intendedUse', 'outputRelativePath'] as const;
  const requestIds = new Set<string>();
  const outputRelativePaths = new Set<string>();
  let estimatedTotal = 0;
  for (const request of value.requests) {
    if (!exactKeys(request, requestKeys)
      || typeof request.requestId !== 'string' || !REQUEST_REF_RE.test(request.requestId)
      || requestIds.has(request.requestId)
      || typeof request.sceneId !== 'string' || !REQUEST_REF_RE.test(request.sceneId)
      || typeof request.prompt !== 'string' || request.prompt.length < 1 || request.prompt.length > 1000
      || request.model !== 'kling3_0'
      || typeof request.resolution !== 'string' || !EXECUTABLE_RESOLUTIONS.has(request.resolution)
      || !finite(request.durationSeconds) || !Number.isSafeInteger(request.durationSeconds)
      || request.durationSeconds < 1 || request.durationSeconds > 120
      || !finite(request.estimatedCost) || request.estimatedCost < 0 || request.estimatedCost > 100000
      || Number(request.estimatedCost.toFixed(6)) !== request.estimatedCost
      || typeof request.intendedUse !== 'string' || request.intendedUse.length < 1 || request.intendedUse.length > 500
      || typeof request.outputRelativePath !== 'string' || !OUTPUT_RELATIVE_PATH_RE.test(request.outputRelativePath)
      || outputRelativePaths.has(request.outputRelativePath)
      || !exactKeys(request.sourceRange, ['startFrame', 'endFrame'])
      || !Number.isSafeInteger(request.sourceRange.startFrame) || (request.sourceRange.startFrame as number) < 0
      || !Number.isSafeInteger(request.sourceRange.endFrame)
      || (request.sourceRange.endFrame as number) <= (request.sourceRange.startFrame as number)
      || (request.sourceRange.endFrame as number) > 1_000_000_000) return null;
    requestIds.add(request.requestId);
    outputRelativePaths.add(request.outputRelativePath);
    estimatedTotal += request.estimatedCost;
  }
  if (Number(estimatedTotal.toFixed(6)) !== Number(value.estimatedCost.toFixed(6))) return null;
  return value as PaidActionApprovalSummary;
}

export function parsePaidActionApprovalRead(value: unknown, expectedRunId: string): PaidActionApprovalView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'unavailable', reason: 'malformed' };
  const response = value as Record<string, unknown>;
  if (response.ok !== true || !response.run || typeof response.run !== 'object' || Array.isArray(response.run)) {
    return { state: 'unavailable', reason: 'malformed' };
  }
  const run = response.run as Record<string, unknown>;
  if (run.id !== expectedRunId) return { state: 'unavailable', reason: 'malformed' };
  const approval = run.paidActionApproval;
  if (approval === null || approval === undefined) return { state: 'unavailable', reason: 'missing' };
  if (exactKeys(approval, ['contractVersion', 'reason'])
    && approval.contractVersion === 'paid-action-approval-unavailable.v1'
    && approval.reason === 'paid_action_manifest_v3_required') {
    return { state: 'agent_update_required', reason: approval.reason };
  }
  const summary = parsePaidActionApprovalSummary(approval);
  return summary ? { state: 'ready', summary } : { state: 'unavailable', reason: 'malformed' };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validPaidActionApprovalResponse(value: unknown, expected: PaidActionApprovalSummary): boolean {
  if (!exactKeys(value, ['ok', 'requestId', 'approvalDigest', 'summary', 'idempotent'])
    || value.ok !== true || typeof value.requestId !== 'string' || !UUID_RE.test(value.requestId)
    || typeof value.approvalDigest !== 'string' || !SHA256_RE.test(value.approvalDigest)
    || typeof value.idempotent !== 'boolean') return false;
  const summary = parsePaidActionApprovalSummary(value.summary);
  return summary !== null && canonical(summary) === canonical(expected);
}

export function formatPaidActionCost(amount: number, currency: 'USD' | 'credits'): string {
  // Fixed locale keeps the server-rendered client component and browser
  // hydration byte-identical; the currency itself remains explicit.
  if (currency === 'USD') return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} credits`;
}

export function paidActionModelLabel(model: string): string {
  const match = /^kling(\d+)_(\d+)(?:_(turbo))?$/.exec(model);
  if (match) return `Kling ${match[1]}.${match[2]}${match[3] ? ' Turbo' : ''}`;
  return model.split(/[._-]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}
