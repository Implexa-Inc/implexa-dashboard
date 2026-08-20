/**
 * Consumer-side parser for the chain offering wire shape
 * (`marketplace-chain-offering.v1`, backend migration 0213).
 *
 * FAIL CLOSED, LIKE THE EVIDENCE PARSER IT BUILDS ON. A chain offering the
 * buyer is about to acquire must be exactly what the server published: the
 * ordered two-node composition, the typed handoff, the required presenter
 * video, the zero-default ceilings, the credit policy, and one four-channel
 * evidence projection per component. Anything malformed refuses the WHOLE
 * offering — a chain card must never render invented evidence, a partial
 * chain, or ceilings it cannot vouch for. And an unreadable offering never
 * blanks the rest of the Agents surface.
 */

import { BackendError, callBackend } from './api.ts';
import { parseEvidenceChannels, type EvidenceChannels } from './agent-evidence-channels.ts';

export const CHAIN_OFFERING_CONTRACT_VERSION = 'marketplace-chain-offering.v1';

export type ChainNode = {
  ordinal: number;
  role: 'generator' | 'primary';
  name: string;
  taskLabel: string | null;
  version: { id: string; number: string | null; authorityDigest: string; capabilityDigest: string | null; permissionDigest: string | null };
  limitations: string;
  supportedEngines: string[];
  evidenceChannels: EvidenceChannels;
};

export type ChainOffering = {
  kind: 'chain_offering';
  contractVersion: typeof CHAIN_OFFERING_CONTRACT_VERSION;
  slug: string;
  name: string;
  builder: { name: string };
  admission: 'private_preview' | 'admitted';
  privatePreview: boolean;
  version: { id: string; number: number; digest: string; publishedAt: string | null };
  outcome: string;
  orderedChain: [ChainNode, ChainNode];
  handoffKind: 'project_bundle';
  requiredInput: { key: 'presenter_video'; kind: 'file'; label: string; disclosure: string };
  finalArtifactKind: 'video_master';
  qualityModes: Array<'fast' | 'balanced' | 'best'>;
  creditPolicy: { maxTotalCredits: number; generatorBudgetSharePercent: number };
  consequentialCeiling: { maxProviderCalls: number; maxSpendMinor: number; currency: string; zeroDefault: boolean };
  supportedEngines: Array<'claude' | 'codex'>;
  evidenceContractVersion: 'marketplace-evidence-channels.v1';
  acquisition: { id: string; lifecycle: 'installed'; offeringDigest: string; offeringVersionId: string; authority: 'exact' | 'upgrade_required' } | null;
  historyLanguage: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
// The projection is server-scrubbed; this is the consumer backstop.
const LEAK_RE = /(\/Users\/|\/home\/|[A-Za-z]:\\)|((sk_(live|test)_|ghp_|github_pat_|AKIA|whsec_)[A-Za-z0-9_-]{8,})|([^\s@"']+@[^\s@"']+\.[a-z]{2,})/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function parseNode(value: unknown, ordinal: number): ChainNode | null {
  if (!isPlainObject(value)) return null;
  if (value.ordinal !== ordinal) return null;
  if (value.role !== (ordinal === 0 ? 'generator' : 'primary')) return null;
  if (typeof value.name !== 'string' || !value.name.trim()) return null;
  const version = value.version;
  if (!isPlainObject(version) || typeof version.id !== 'string' || !UUID_RE.test(version.id)) return null;
  if (typeof version.authorityDigest !== 'string' || !SHA256_RE.test(version.authorityDigest)) return null;
  if (typeof value.limitations !== 'string' || !value.limitations.trim()) return null;
  if (!Array.isArray(value.supportedEngines) || value.supportedEngines.some((engine) => typeof engine !== 'string')) return null;
  // The component's evidence is a full WP1/WP2 projection, parsed by the same
  // fail-closed parser the agent resume uses. Its refusal refuses the node.
  const evidence = parseEvidenceChannels(value.evidenceChannels);
  if (evidence.status !== 'ready') return null;
  return {
    ordinal,
    role: ordinal === 0 ? 'generator' : 'primary',
    name: value.name,
    taskLabel: typeof value.taskLabel === 'string' ? value.taskLabel : null,
    version: {
      id: version.id.toLowerCase(),
      number: typeof version.number === 'string' ? version.number : null,
      authorityDigest: version.authorityDigest,
      capabilityDigest: typeof version.capabilityDigest === 'string' && SHA256_RE.test(version.capabilityDigest) ? version.capabilityDigest : null,
      permissionDigest: typeof version.permissionDigest === 'string' && SHA256_RE.test(version.permissionDigest) ? version.permissionDigest : null,
    },
    limitations: value.limitations,
    supportedEngines: [...value.supportedEngines] as string[],
    evidenceChannels: evidence.channels,
  };
}

export type ChainOfferingResult =
  | { status: 'ready'; offering: ChainOffering }
  | { status: 'unavailable'; reason: string };

export function parseChainOffering(value: unknown): ChainOfferingResult {
  const unavailable = (reason: string): ChainOfferingResult => ({ status: 'unavailable', reason });
  if (!isPlainObject(value)) return unavailable('The chain offering could not be read.');
  if (value.kind !== 'chain_offering') return unavailable('The chain offering could not be read.');
  if (value.contractVersion !== CHAIN_OFFERING_CONTRACT_VERSION) return unavailable('The chain offering uses an unsupported contract version.');
  if (typeof value.slug !== 'string' || typeof value.name !== 'string' || !value.name.trim()) return unavailable('The chain offering could not be read.');
  if (!isPlainObject(value.builder) || typeof value.builder.name !== 'string') return unavailable('The chain offering could not be read.');
  if (value.admission !== 'private_preview' && value.admission !== 'admitted') return unavailable('The chain offering could not be read.');
  if (value.privatePreview !== (value.admission === 'private_preview')) return unavailable('The chain offering could not be read.');
  const version = value.version;
  if (!isPlainObject(version) || typeof version.id !== 'string' || !UUID_RE.test(version.id)
    || typeof version.digest !== 'string' || !SHA256_RE.test(version.digest)
    || !bounded(version.number, 1, 1000000)) {
    return unavailable('The chain offering could not be read.');
  }
  if (value.handoffKind !== 'project_bundle') return unavailable('The chain offering could not be read.');
  if (value.finalArtifactKind !== 'video_master') return unavailable('The chain offering could not be read.');
  const requiredInput = value.requiredInput;
  if (!isPlainObject(requiredInput) || requiredInput.key !== 'presenter_video' || requiredInput.kind !== 'file'
    || typeof requiredInput.label !== 'string'
    || typeof requiredInput.disclosure !== 'string'
    || !requiredInput.disclosure.includes('Local paths are never sent to the server')) {
    // A chain without the required-input disclosure is not renderable: the
    // buyer must see what is required, and the local-paths promise, BEFORE
    // anything can start.
    return unavailable('The chain offering could not be read.');
  }
  const ceiling = value.consequentialCeiling;
  if (!isPlainObject(ceiling) || !bounded(ceiling.maxProviderCalls, 0, 100) || !bounded(ceiling.maxSpendMinor, 0, 1000000000)
    || typeof ceiling.currency !== 'string'
    || ceiling.zeroDefault !== (ceiling.maxProviderCalls === 0 && ceiling.maxSpendMinor === 0)) {
    // zeroDefault is DERIVED; a payload asserting zero-default over non-zero
    // ceilings is lying about consequences.
    return unavailable('The chain offering could not be read.');
  }
  const creditPolicy = value.creditPolicy;
  if (!isPlainObject(creditPolicy) || !bounded(creditPolicy.maxTotalCredits, 1, 100000)
    || !bounded(creditPolicy.generatorBudgetSharePercent, 1, 99)) {
    return unavailable('The chain offering could not be read.');
  }
  if (!Array.isArray(value.orderedChain) || value.orderedChain.length !== 2) return unavailable('The chain offering could not be read.');
  const generator = parseNode(value.orderedChain[0], 0);
  const primary = parseNode(value.orderedChain[1], 1);
  if (!generator || !primary) return unavailable('A component of this chain could not be verified, so the offering is withheld.');
  if (generator.version.id === primary.version.id) return unavailable('The chain offering could not be read.');
  const qualityModes = value.qualityModes;
  if (!Array.isArray(qualityModes) || qualityModes.length < 1 || qualityModes.length > 3
    || qualityModes.some((mode) => !['fast', 'balanced', 'best'].includes(String(mode)))
    || new Set(qualityModes).size !== qualityModes.length) return unavailable('The chain offering could not be read.');
  const supportedEngines = value.supportedEngines;
  if (!Array.isArray(supportedEngines) || supportedEngines.length < 1
    || supportedEngines.some((engine) => !['claude', 'codex'].includes(String(engine)))
    || new Set(supportedEngines).size !== supportedEngines.length) return unavailable('The chain offering could not be read.');
  if (value.evidenceContractVersion !== 'marketplace-evidence-channels.v1') return unavailable('The chain offering could not be read.');
  if (typeof value.historyLanguage !== 'string' || !value.historyLanguage.includes('removes access, not history')) {
    return unavailable('The chain offering could not be read.');
  }
  let acquisition: ChainOffering['acquisition'] = null;
  if (value.acquisition !== null && value.acquisition !== undefined) {
    const raw = value.acquisition;
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || raw.lifecycle !== 'installed'
      || typeof raw.offeringDigest !== 'string' || !SHA256_RE.test(raw.offeringDigest)
      || typeof raw.offeringVersionId !== 'string' || !UUID_RE.test(raw.offeringVersionId)
      || (raw.authority !== 'exact' && raw.authority !== 'upgrade_required')) {
      return unavailable('The chain offering could not be read.');
    }
    const isExact = raw.offeringVersionId.toLowerCase() === version.id.toLowerCase()
      && raw.offeringDigest === version.digest;
    if ((raw.authority === 'exact') !== isExact) return unavailable('The chain offering could not be read.');
    acquisition = { id: raw.id, lifecycle: 'installed', offeringDigest: raw.offeringDigest,
      offeringVersionId: raw.offeringVersionId.toLowerCase(), authority: raw.authority };
  }
  const offering: ChainOffering = {
    kind: 'chain_offering',
    contractVersion: CHAIN_OFFERING_CONTRACT_VERSION,
    slug: value.slug,
    name: value.name,
    builder: { name: value.builder.name },
    admission: value.admission,
    privatePreview: value.privatePreview,
    version: { id: version.id.toLowerCase(), number: version.number, digest: version.digest, publishedAt: typeof version.publishedAt === 'string' ? version.publishedAt : null },
    outcome: typeof value.outcome === 'string' ? value.outcome : '',
    orderedChain: [generator, primary],
    handoffKind: 'project_bundle',
    requiredInput: { key: 'presenter_video', kind: 'file', label: requiredInput.label, disclosure: requiredInput.disclosure },
    finalArtifactKind: 'video_master',
    qualityModes: [...qualityModes] as Array<'fast' | 'balanced' | 'best'>,
    creditPolicy: { maxTotalCredits: creditPolicy.maxTotalCredits, generatorBudgetSharePercent: creditPolicy.generatorBudgetSharePercent },
    consequentialCeiling: { maxProviderCalls: ceiling.maxProviderCalls, maxSpendMinor: ceiling.maxSpendMinor, currency: ceiling.currency, zeroDefault: ceiling.zeroDefault === true },
    supportedEngines: [...supportedEngines] as Array<'claude' | 'codex'>,
    evidenceContractVersion: 'marketplace-evidence-channels.v1',
    acquisition,
    historyLanguage: value.historyLanguage,
  };
  if (LEAK_RE.test(JSON.stringify(offering))) return unavailable('The chain offering could not be read.');
  return { status: 'ready', offering };
}

export type ChainOfferingsResult =
  | { status: 'ready'; offerings: ChainOffering[] }
  | { status: 'unavailable'; offerings: []; reason: string };

export async function listChainOfferings(jwt: string): Promise<ChainOfferingsResult> {
  try {
    const response = await callBackend('/api/v2/agents/discovery/chains', { jwt });
    const raw = Array.isArray(response?.offerings) ? response.offerings : [];
    // Fail closed PER OFFERING: one unreadable offering is withheld without
    // blanking the readable ones or the surface around them.
    const offerings = raw
      .map((entry: unknown) => parseChainOffering(entry))
      .filter((parsed: ChainOfferingResult): parsed is { status: 'ready'; offering: ChainOffering } => parsed.status === 'ready')
      .map((parsed: { offering: ChainOffering }) => parsed.offering);
    return { status: 'ready', offerings };
  } catch (error) {
    return { status: 'unavailable', offerings: [], reason: error instanceof Error ? error.message : 'Chain offerings are unavailable.' };
  }
}

export type OneChainOfferingResult =
  | { status: 'found'; offering: ChainOffering }
  | { status: 'not_available' }
  | { status: 'unavailable'; reason: string };

export async function getChainOffering(slug: string, jwt: string): Promise<OneChainOfferingResult> {
  try {
    const response = await callBackend(`/api/v2/agents/discovery/chains/${encodeURIComponent(slug)}`, { jwt });
    const parsed = parseChainOffering(response?.offering);
    if (parsed.status !== 'ready') return { status: 'unavailable', reason: parsed.reason };
    return { status: 'found', offering: parsed.offering };
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) return { status: 'not_available' };
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'The chain offering is unavailable.' };
  }
}
