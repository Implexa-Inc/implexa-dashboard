/**
 * lib/setup-required.ts — the typed `setup_required` refusal (backend 0346).
 *
 * WHY. The Visual Evidence & Remotion Compositor reached step 10/19 before
 * discovering the required Higgsfield CLI was absent on the selected Mac. Now
 * the backend compares the applied version's frozen machine requirements with
 * that machine's own fresh attestation at the Run click and refuses with this
 * card BEFORE any request, run or launch exists. The Dashboard renders it; it
 * never infers CLI availability itself and never sends readiness claims — the
 * only thing it may name is WHICH machine the Desktop bridge says it is.
 *
 * This module is pure: parse the card from a 409 body, and derive copy.
 */

export type SetupItemState =
  | 'ready' | 'missing' | 'not_executable' | 'unsupported_version' | 'unauthenticated' | 'model_unavailable'
  | 'tls_failed' | 'insufficient' | 'probe_failed' | 'probe_unsupported' | 'degraded' | 'not_checked' | 'stale' | 'fallback';

export type SetupAction = 'open_setup' | 'recheck' | 'cancel' | 'install_cli' | 'sign_in_cli' | 'install_runtime' | 'free_disk' | 'install_media_tools';

export type SetupRequiredItem = {
  id: string;
  label: string;
  required: boolean;
  state: SetupItemState | string;
  /** Customer-safe state label, rendered verbatim ("Not installed"). */
  stateLabel: string;
  reason?: string;
  actions?: SetupAction[] | string[];
  setupTitle?: string;
  instructions?: string[];
  fallback?: string | null;
};

export type SetupRequiredCard = {
  code: 'setup_required';
  title: string;
  reason: string;
  machine: { id: string | null; label?: string | null; online: boolean };
  contract?: { profile_id?: string | null; digest?: string | null };
  /** The agent + FROZEN version the refusal is about (backend 0346). A
   *  continuation surface that has no slug of its own routes setup from this. */
  agent?: { slug: string | null; workflow_version_id: string | null } | null;
  items: SetupRequiredItem[];
  actions: SetupAction[] | string[];
};

const AGENT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,159}$/;
const VERSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MACHINE_ID_RE = /^[a-zA-Z0-9._:-]{1,200}$/;
export const isAgentSlug = (value: unknown): value is string => typeof value === 'string' && AGENT_SLUG_RE.test(value);
export const isWorkflowVersionId = (value: unknown): value is string => typeof value === 'string' && VERSION_ID_RE.test(value);
export const isMachineId = (value: unknown): value is string => typeof value === 'string' && MACHINE_ID_RE.test(value);

/** The typed card from a 409 body, or null for any other error.
 * Duck-typed on `{ status: 409, body }` (the shape BackendError carries) rather
 * than `instanceof`, so a bundled copy of the class in a test harness — or a
 * proxy that re-wraps the error — cannot turn a typed refusal into a dead end. */
export function parseSetupRequired(error: unknown): SetupRequiredCard | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { status?: unknown; body?: unknown };
  if (e.status !== 409) return null;
  return setupRequiredFromBody(e.body);
}

export function setupRequiredFromBody(body: unknown): SetupRequiredCard | null {
  const card = body && typeof body === 'object' ? (body as { setupRequired?: unknown }).setupRequired : null;
  if (!card || typeof card !== 'object') return null;
  const c = card as Partial<SetupRequiredCard>;
  if (c.code !== 'setup_required' || !Array.isArray(c.items)) return null;
  return {
    code: 'setup_required',
    title: typeof c.title === 'string' && c.title ? c.title : 'Setup required before this agent can run.',
    reason: typeof c.reason === 'string' ? c.reason : 'required_capability_not_ready',
    // Unknown presence is not offline proof. Default it to online-shaped so a
    // malformed/older card can never enter exact-offline automatic recovery.
    machine: { id: c.machine && typeof c.machine.id === 'string' ? c.machine.id : null, label: c.machine?.label ?? null, online: c.machine?.online !== false },
    contract: c.contract,
    agent: c.agent && typeof c.agent === 'object' && (isAgentSlug(c.agent.slug) || isWorkflowVersionId(c.agent.workflow_version_id))
      ? { slug: isAgentSlug(c.agent.slug) ? c.agent.slug : null, workflow_version_id: isWorkflowVersionId(c.agent.workflow_version_id) ? c.agent.workflow_version_id : null }
      : null,
    items: c.items.filter((i): i is SetupRequiredItem => !!i && typeof i === 'object' && typeof (i as SetupRequiredItem).label === 'string')
      .map((i) => ({ ...i, stateLabel: typeof i.stateLabel === 'string' ? i.stateLabel : 'Not verified', required: i.required === true })),
    actions: Array.isArray(c.actions) ? c.actions : ['open_setup', 'recheck', 'cancel'],
  };
}

/** The backend reason for a refusal about the AGENT VERSION rather than this
 * computer (backend 0371 admission, typed by 0386). */
export const VERSION_CONTRACT_REASON = 'deterministic_project_machine_capability_required';

/** A version-contract refusal: this agent version cannot be admitted on ANY
 * computer, so Setup cannot fix it. Production's Planner v26 hit this and the
 * owner saw only "Request failed (409)", because the pre-run admission check
 * sent no sentence and the client fell back to its status code. */
export type VersionContractRefusal = {
  code: 'version_contract_refused';
  title: string;
  message: string;
  /** The backend's typed cause, or null from a backend older than 0386. */
  cause: string | null;
  /** Only an unreadable read can succeed on retry; an incomplete version cannot. */
  retrySafe: boolean;
  workflowVersionId: string | null;
};

// Used ONLY when the backend sent no sentence (a pin older than 0386). The
// backend owns the per-cause wording; this is the honest general case, never
// a status code.
const VERSION_CONTRACT_FALLBACK = 'This version of the agent cannot be checked against any computer. Revise the agent to publish a complete version. Nothing was queued.';
const VERSION_CONTRACT_RETRY_FALLBACK = 'Implexa could not read this agent version\u2019s requirements. Try again; nothing was queued.';

/** The typed version-contract refusal from a 409, or null for any other error.
 * Duck-typed on `{ status: 409, body }` for the same reason as parseSetupRequired. */
export function parseVersionContractRefusal(error: unknown): VersionContractRefusal | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { status?: unknown; body?: unknown };
  if (e.status !== 409) return null;
  return versionContractRefusalFromBody(e.body);
}

export function versionContractRefusalFromBody(body: unknown): VersionContractRefusal | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { reason?: unknown; error?: unknown; cause?: unknown; retrySafe?: unknown; workflowVersionId?: unknown; setupRequired?: unknown };
  if (b.reason !== VERSION_CONTRACT_REASON) return null;
  // A setup card is about this computer and has its own modal; it wins.
  if (b.setupRequired) return null;
  const retrySafe = b.retrySafe === true;
  const sentence = typeof b.error === 'string' && b.error.trim() ? b.error.trim() : null;
  return {
    code: 'version_contract_refused',
    title: retrySafe ? 'Couldn\u2019t read this agent version' : 'This agent version is incomplete',
    message: sentence || (retrySafe ? VERSION_CONTRACT_RETRY_FALLBACK : VERSION_CONTRACT_FALLBACK),
    cause: typeof b.cause === 'string' && /^[a-z][a-z0-9_]{2,63}$/.test(b.cause) ? b.cause : null,
    retrySafe,
    workflowVersionId: isWorkflowVersionId(b.workflowVersionId) ? b.workflowVersionId : null,
  };
}

/** Why the card was raised, in the user's terms. Reason codes are the backend's closed set. */
export function setupReasonCopy(card: SetupRequiredCard): string {
  switch (card.reason) {
    case 'machine_offline': return 'This computer has not reported to Implexa in the last few minutes. Open the Implexa app on it, then Recheck.';
    case 'machine_unavailable': return 'No computer has reported to Implexa yet. Open the Implexa app on the Mac that should run this agent.';
    case 'execution_engine_unavailable': return 'This computer is online, but no supported execution engine is currently available. Open its setup to reconnect Claude or Codex.';
    case 'execution_engine_unauthenticated': return 'This computer is online, but its execution engine is not signed in. Sign in to Claude or Codex on that computer, then Recheck.';
    case 'attestation_missing': return 'Implexa has not checked this computer’s setup yet. Recheck to run the check now.';
    case 'attestation_stale': return 'The last setup check on this computer expired. Recheck to run it again.';
    case 'attestation_foreign_machine': return 'The setup check on file belongs to a different computer. Recheck on the selected one.';
    default: return 'Some requirements are not ready on the selected computer. Set them up, then Recheck to continue the same run.';
  }
}

/** "Checking: Mac mini (studio)" — which computer readiness belongs to. */
export function machineCopy(card: SetupRequiredCard): string {
  const label = card.machine.label || (card.machine.id ? `Mac ${card.machine.id.slice(0, 8)}` : 'this computer');
  return `${label}${card.machine.online ? '' : ' (offline)'}`;
}

/** Items the user must act on: required and not ready. Optional fallbacks are listed, never blocking. */
export function blockingItems(card: SetupRequiredCard): SetupRequiredItem[] {
  return card.items.filter((item) => item.required && item.state !== 'ready');
}

/** A narrow transient refusal that a fresh Desktop attestation may repair.
 *
 * This is deliberately stricter than "the card has a probe failure". Automatic
 * recovery is allowed only when every required blocker is an inconclusive probe
 * on the online, named machine and the backend offered Recheck. Missing tools,
 * authentication, model access, TLS failures, stale/offline machines, and mixed
 * cards always remain explicit user decisions.
 */
export function isProbeOnlySetupRefusal(card: SetupRequiredCard): boolean {
  const blockers = blockingItems(card);
  return card.reason === 'required_capability_not_ready'
    && card.machine.online === true
    && isMachineId(card.machine.id)
    && card.actions.includes('recheck')
    && blockers.length > 0
    && blockers.every((item) => item.state === 'probe_failed');
}

/** A contradictory liveness refusal that THIS Desktop can safely try to repair.
 *
 * `machine_offline` is deliberately separate from probe-only recovery. An
 * offline machine must never be refreshed by whichever browser happens to be
 * open: the caller additionally proves that the injected Desktop bridge names
 * this exact machine before asking Desktop to renew its backend presence lease
 * and capability attestation. `not_checked` is part of the typed offline card;
 * a mixed or otherwise malformed card remains an explicit user decision.
 */
export function isExactMachineOfflineSetupRefusal(card: SetupRequiredCard): boolean {
  const blockers = blockingItems(card);
  return card.reason === 'machine_offline'
    && card.machine.online === false
    && isMachineId(card.machine.id)
    && card.actions.includes('recheck')
    && blockers.length > 0
    && blockers.every((item) => item.state === 'not_checked');
}

export type SetupScope = { machineId?: string | null; workflowVersionId?: string | null };

/** `machine/<id>` and `version/<id>` named segments — path segments only,
 * because the app's implexa:// deep-link router drops query strings. */
function scopeSegments({ machineId = null, workflowVersionId = null }: SetupScope = {}): string {
  return `${isMachineId(machineId) ? `/machine/${encodeURIComponent(machineId)}` : ''}${isWorkflowVersionId(workflowVersionId) ? `/version/${encodeURIComponent(workflowVersionId)}` : ''}`;
}

/** The in-app setup page for THIS agent and FROZEN version on THE SELECTED
 * machine: "Open setup in Implexa" lands on exactly that computer's requirement
 * list for exactly the version that was refused. */
export function machineSetupPath(slug: string, scope: SetupScope = {}): string {
  return `/settings/machine-setup/${encodeURIComponent(slug)}${scopeSegments(scope)}`;
}
export function appMachineSetupUrl(slug: string, scope: SetupScope = {}): string {
  return `implexa://settings/machine-setup/${encodeURIComponent(slug)}${scopeSegments(scope)}`;
}

/** Parse the optional `[[...scope]]` segments of the setup route. Unknown or
 * malformed segments → null (the page 404s rather than guessing). */
export function parseSetupScope(segments: string[] | undefined): { machineId: string | null; workflowVersionId: string | null } | null {
  const parts = (segments || []).map((part) => { try { return decodeURIComponent(part); } catch { return part; } });
  if (parts.length % 2 !== 0 || parts.length > 4) return null;
  const out = { machineId: null as string | null, workflowVersionId: null as string | null };
  for (let i = 0; i < parts.length; i += 2) {
    const [key, value] = [parts[i], parts[i + 1]];
    if (key === 'machine' && !out.machineId && isMachineId(value)) out.machineId = value;
    else if (key === 'version' && !out.workflowVersionId && isWorkflowVersionId(value)) out.workflowVersionId = value;
    else return null;
  }
  return out;
}

/** Where "Open setup" goes for a card: the surface's own slug/version when it
 * has them, else the agent the backend named on the card. null = unknown — the
 * caller must NOT invent a path. */
export function setupTargetFor(card: SetupRequiredCard, { slug = null, workflowVersionId = null }: { slug?: string | null; workflowVersionId?: string | null } = {}) {
  const agentSlug = isAgentSlug(slug) ? slug : (card.agent && isAgentSlug(card.agent.slug) ? card.agent.slug : null);
  if (!agentSlug) return null;
  const version = isWorkflowVersionId(workflowVersionId) ? workflowVersionId
    : (card.agent && isWorkflowVersionId(card.agent.workflow_version_id) ? card.agent.workflow_version_id : null);
  const scope = { machineId: card.machine.id, workflowVersionId: version };
  return { slug: agentSlug, workflowVersionId: version, path: machineSetupPath(agentSlug, scope), appUrl: appMachineSetupUrl(agentSlug, scope) };
}

/** Customer-facing copy for each backend setup action (the closed set). The
 * page renders the backend's `instructions` verbatim next to these. */
export const SETUP_ACTION_COPY: Record<string, { label: string; explicit: string }> = {
  install_runtime: { label: 'Install the runtime', explicit: 'Installs the Implexa-managed Node runtime on this computer when you choose to.' },
  install_cli: { label: 'Install', explicit: 'Opens the vendor’s install instructions; you run the install yourself.' },
  install_media_tools: { label: 'Install media tools', explicit: 'Installs ffmpeg/ffprobe through Implexa’s tool registry when you choose to.' },
  sign_in_cli: { label: 'Sign in', explicit: 'Sign in with the vendor’s own CLI in a terminal; Implexa only re-checks the account status afterwards and never sees the credential.' },
  free_disk: { label: 'Free up space', explicit: 'Free space on this computer, then Recheck.' },
  recheck: { label: 'Recheck', explicit: 'Re-checks this computer and asks Implexa to decide again.' },
};
