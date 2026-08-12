import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMarketplaceExecutionRequirements, setupOwnerLabel } from './marketplace-execution-requirements.ts';

const digest = 'a'.repeat(64);
function fixture() {
  return {
    contract_type: 'marketplace_execution_requirements', contract_version: 1, digest,
    requirements: [
      { id: 'cli', requirement_type: 'local_cli', required: true, permission_category: 'source_control_read', reactivation_on_change: true, max_invocations_per_run: 1,
        setup: { owner: 'desktop', title: 'Sign in', instructions: ['Authenticate in Terminal.'] },
        integration: { cli_id: 'github', min_version: '2.0.0', max_version_exclusive: null, capabilities: ['repository.read'] } },
      { id: 'mcp', requirement_type: 'mcp_server', required: true, permission_category: 'data_read', reactivation_on_change: true, max_invocations_per_run: 4,
        setup: { owner: 'mcp_server', title: 'Connect server', instructions: ['Approve exact tools.'] },
        integration: { server_id: 'files', transport_class: 'stdio', trust_class: 'bundled_trusted', tools: [{ name: 'read_file', contract_version: '1.2.0' }] } },
      { id: 'api', requirement_type: 'api_credential', required: false, permission_category: 'paid_provider', reactivation_on_change: true, max_invocations_per_run: 10,
        setup: { owner: 'server_vault', title: 'Register provider access', instructions: ['Save it in the organization vault.'] },
        integration: { provider: 'fixture', environment: 'production', capabilities: ['video.generate'], spend_authority: { currency: 'USD', max_per_run_minor: 250 } } },
    ],
  };
}

test('strict dashboard parser renders only the versioned public projection', () => {
  const parsed = parseMarketplaceExecutionRequirements(fixture());
  assert.ok(parsed);
  assert.deepEqual(parsed.requirements.map((item) => item.requirement_type), ['local_cli', 'mcp_server', 'api_credential']);
  assert.deepEqual(parsed.requirements.map((item) => item.max_invocations_per_run), [1, 4, 10]);
  assert.equal(setupOwnerLabel('desktop'), 'Desktop / macOS Keychain');
  assert.equal(setupOwnerLabel('mcp_server'), 'MCP server');
  assert.equal(setupOwnerLabel('server_vault'), 'Organization server vault');
});

test('omitted, null, blank and unknown discriminators refuse rather than infer legacy', () => {
  for (const value of [undefined, null, '', 'legacy']) {
    const mutant = fixture() as Record<string, unknown>;
    if (value === undefined) delete mutant.contract_type; else mutant.contract_type = value;
    assert.equal(parseMarketplaceExecutionRequirements(mutant), null);
  }
  const requirement = fixture();
  (requirement.requirements[0] as unknown as Record<string, unknown>).requirement_type = null;
  assert.equal(parseMarketplaceExecutionRequirements(requirement), null);
});

test('private runtime, defensive, credential-reference and secret fields reject the whole view', () => {
  for (const field of ['secret_handle', 'credential_reference_id', 'private_prompt', 'defensive_telemetry', 'runtime_context', 'internal_policy', 'hidden_execution_heuristics']) {
    const mutant = fixture() as unknown as Record<string, unknown>;
    mutant[field] = { hidden: true };
    assert.equal(parseMarketplaceExecutionRequirements(mutant), null, field);
  }
  const nestedUnknown = fixture();
  (nestedUnknown.requirements[0].integration as Record<string, unknown>).executable_path = '/tmp/cli';
  assert.equal(parseMarketplaceExecutionRequirements(nestedUnknown), null);
});

test('missing, zero, and oversized invocation authority refuse the public contract', () => {
  for (const value of [undefined, 0, 10_001]) {
    const mutant = fixture();
    const row = mutant.requirements[0] as unknown as Record<string, unknown>;
    if (value === undefined) delete row.max_invocations_per_run; else row.max_invocations_per_run = value;
    assert.equal(parseMarketplaceExecutionRequirements(mutant), null);
  }
  const oversizedTotal = fixture();
  oversizedTotal.requirements[0].max_invocations_per_run = 5_000;
  oversizedTotal.requirements[1].max_invocations_per_run = 5_000;
  assert.equal(parseMarketplaceExecutionRequirements(oversizedTotal), null);
});

test('activation UI names all secret owners, exact MCP tools, permissions and spend authority without credential inputs', () => {
  const component = readFileSync(fileURLToPath(new URL('../app/(dashboard)/_components/marketplace-execution-requirements.tsx', import.meta.url)), 'utf8');
  assert.match(component, /Secret owner:/);
  assert.match(component, /Exact tools:/);
  assert.match(component, /Spend authority:/);
  assert.match(component, /Invocation authority:/);
  assert.match(component, /permission_category/);
  assert.doesNotMatch(component, /type=["']password|credential_reference|secret_handle|localStorage|sessionStorage/);
});

test('activation card mounts signed execution disclosure before legacy inferred requirements', () => {
  const card = readFileSync(fileURLToPath(new URL('../app/(dashboard)/_components/activation-card.tsx', import.meta.url)), 'utf8');
  assert.ok(card.indexOf('<MarketplaceExecutionRequirementsCard') < card.indexOf('<ActivationRequirements'));
});
