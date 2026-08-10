export type MarketplaceSetupOwner = 'desktop' | 'mcp_server' | 'server_vault';
export type MarketplaceRequirementType = 'local_cli' | 'mcp_server' | 'api_credential';

export type MarketplaceExecutionRequirement = {
  id: string;
  requirement_type: MarketplaceRequirementType;
  required: boolean;
  permission_category: string;
  reactivation_on_change: boolean;
  setup: { owner: MarketplaceSetupOwner; title: string; instructions: string[] };
  integration: {
    cli_id?: string;
    min_version?: string | null;
    max_version_exclusive?: string | null;
    server_id?: string;
    transport_class?: string;
    trust_class?: string;
    tools?: Array<{ name: string; contract_version: string }>;
    provider?: string;
    environment?: string;
    capabilities?: string[];
    spend_authority?: { currency: string; max_per_run_minor: number } | null;
  };
};

export type MarketplaceExecutionRequirements = {
  contract_type: 'marketplace_execution_requirements';
  contract_version: 1;
  digest: string;
  requirements: MarketplaceExecutionRequirement[];
};

const TYPES = new Set(['local_cli', 'mcp_server', 'api_credential']);
const OWNERS = new Set(['desktop', 'mcp_server', 'server_vault']);
const TRANSPORTS = new Set(['stdio', 'local_http', 'remote_https']);
const TRUST_CLASSES = new Set(['bundled_trusted', 'locally_configured', 'remote_marketplace']);
const PRIVATE_FIELD = /(secret|password|token|api.?key|credential.?value|credential_reference|private.?prompt|defensive|runtime.?context|internal.?policy|config.?path)/i;
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const set = new Set(allowed);
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => set.has(key));
}
function text(value: unknown, max = 500): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null;
}
function textList(value: unknown, { min = 1, max = 64 }: { min?: number; max?: number } = {}): string[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const clean = value.map((item) => text(item, 500));
  return clean.some((item) => item === null) ? null : clean as string[];
}
function hasPrivateField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasPrivateField);
  return Object.entries(value as Record<string, unknown>)
    .some(([key, child]) => PRIVATE_FIELD.test(key) || hasPrivateField(child));
}

export function parseMarketplaceExecutionRequirements(value: unknown): MarketplaceExecutionRequirements | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  // Unknown versions and explicit null/blank discriminators are refusals, never
  // an invitation to infer a legacy shape.
  if (row.contract_type !== 'marketplace_execution_requirements' || row.contract_version !== 1
    || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest)
    || !Array.isArray(row.requirements) || row.requirements.length > 64
    || hasPrivateField(row)
    || !exactKeys(row, ['contract_type', 'contract_version', 'digest', 'requirements'])) return null;
  const requirements: MarketplaceExecutionRequirement[] = [];
  for (const raw of row.requirements) {
    const item = record(raw);
    if (!item || !exactKeys(item, ['id', 'requirement_type', 'required', 'permission_category', 'reactivation_on_change', 'setup', 'integration'])) return null;
    const requirementType = text(item.requirement_type, 40);
    const id = text(item.id, 120);
    const permission = text(item.permission_category, 80);
    const setup = record(item.setup);
    const integration = record(item.integration);
    if (!id || !requirementType || !TYPES.has(requirementType) || !permission
      || typeof item.required !== 'boolean' || typeof item.reactivation_on_change !== 'boolean'
      || !setup || !integration || !exactKeys(setup, ['owner', 'title', 'instructions'])) return null;
    const owner = text(setup.owner, 40);
    const title = text(setup.title, 160);
    const instructions = textList(setup.instructions, { min: 1, max: 12 });
    if (!owner || !OWNERS.has(owner) || !title || !instructions) return null;

    let publicIntegration: MarketplaceExecutionRequirement['integration'];
    if (requirementType === 'local_cli') {
      if (!exactKeys(integration, ['cli_id', 'min_version', 'max_version_exclusive', 'capabilities'])) return null;
      const cliId = text(integration.cli_id, 120);
      const capabilities = textList(integration.capabilities);
      const minVersion = integration.min_version === null ? null : text(integration.min_version, 80);
      const maxVersion = integration.max_version_exclusive === null ? null : text(integration.max_version_exclusive, 80);
      if (!cliId || !capabilities || minVersion === null && integration.min_version !== null
        || maxVersion === null && integration.max_version_exclusive !== null) return null;
      publicIntegration = { cli_id: cliId, min_version: minVersion, max_version_exclusive: maxVersion, capabilities };
    } else if (requirementType === 'mcp_server') {
      if (!exactKeys(integration, ['server_id', 'transport_class', 'trust_class', 'tools']) || !Array.isArray(integration.tools)
        || integration.tools.length < 1 || integration.tools.length > 64) return null;
      const serverId = text(integration.server_id, 120);
      const transport = text(integration.transport_class, 40);
      const trust = text(integration.trust_class, 40);
      const tools: Array<{ name: string; contract_version: string }> = [];
      for (const rawTool of integration.tools) {
        const tool = record(rawTool);
        const name = tool && text(tool.name, 160);
        const version = tool && text(tool.contract_version, 80);
        if (!tool || !exactKeys(tool, ['name', 'contract_version']) || !name || !version) return null;
        tools.push({ name, contract_version: version });
      }
      if (!serverId || !transport || !TRANSPORTS.has(transport) || !trust || !TRUST_CLASSES.has(trust)) return null;
      publicIntegration = { server_id: serverId, transport_class: transport, trust_class: trust, tools };
    } else {
      if (!exactKeys(integration, ['provider', 'environment', 'capabilities', 'spend_authority'])) return null;
      const provider = text(integration.provider, 120);
      const environment = text(integration.environment, 80);
      const capabilities = textList(integration.capabilities);
      const spend = integration.spend_authority === null ? null : record(integration.spend_authority);
      if (!provider || !environment || !capabilities || (spend && !exactKeys(spend, ['currency', 'max_per_run_minor']))) return null;
      const currency = spend && text(spend.currency, 3);
      const maxSpend = spend?.max_per_run_minor;
      if (spend && (!currency || !/^[A-Z]{3}$/.test(currency) || typeof maxSpend !== 'number'
        || !Number.isSafeInteger(maxSpend) || maxSpend < 0)) return null;
      publicIntegration = { provider, environment, capabilities, spend_authority: spend ? { currency: currency!, max_per_run_minor: Number(maxSpend) } : null };
    }
    requirements.push({
      id, requirement_type: requirementType as MarketplaceRequirementType, required: item.required,
      permission_category: permission, reactivation_on_change: item.reactivation_on_change,
      setup: { owner: owner as MarketplaceSetupOwner, title, instructions }, integration: publicIntegration,
    });
  }
  return { contract_type: 'marketplace_execution_requirements', contract_version: 1, digest: row.digest, requirements };
}

export function setupOwnerLabel(owner: MarketplaceSetupOwner): string {
  if (owner === 'desktop') return 'Desktop / macOS Keychain';
  if (owner === 'mcp_server') return 'MCP server';
  return 'Organization server vault';
}
