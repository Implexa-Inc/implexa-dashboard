'use client';

import type { MarketplaceExecutionRequirements } from '@/lib/marketplace-execution-requirements';
import { setupOwnerLabel } from '@/lib/marketplace-execution-requirements';

function integrationLabel(requirement: MarketplaceExecutionRequirements['requirements'][number]): string {
  const integration = requirement.integration;
  if (requirement.requirement_type === 'local_cli') return `${integration.cli_id} CLI`;
  if (requirement.requirement_type === 'mcp_server') return `${integration.server_id} MCP server`;
  return `${integration.provider} (${integration.environment})`;
}

export function MarketplaceExecutionRequirementsCard({ contract }: { contract?: MarketplaceExecutionRequirements | null }) {
  if (!contract || !contract.requirements.length) return null;
  return (
    <section className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4" aria-label="Marketplace execution access">
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Execution access</div>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        This agent can use only the integrations and limits below. Secrets stay with the component named on each row and are never shown to the agent or its author.
      </p>
      <ul className="mt-3 space-y-3">
        {contract.requirements.map((requirement) => {
          const spend = requirement.integration.spend_authority;
          const tools = requirement.integration.tools ?? [];
          return (
            <li key={requirement.id} className="rounded-md border border-ink-800 bg-ink-950/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink-100">{integrationLabel(requirement)}</span>
                <span className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-400">
                  {requirement.required ? 'Required' : 'Optional'}
                </span>
                <span className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  {requirement.permission_category.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-500">Secret owner: {setupOwnerLabel(requirement.setup.owner)}</p>
              <p className="mt-1 text-xs text-ink-500">Invocation authority: at most {requirement.max_invocations_per_run.toLocaleString()} calls per run</p>
              {requirement.integration.capabilities?.length ? (
                <p className="mt-1 text-xs text-ink-500">Allowed capabilities: {requirement.integration.capabilities.join(', ')}</p>
              ) : null}
              {tools.length ? (
                <p className="mt-1 text-xs text-ink-500">Exact tools: {tools.map((tool) => `${tool.name} v${tool.contract_version}`).join(', ')}</p>
              ) : null}
              {spend ? (
                <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Spend authority: at most {(spend.max_per_run_minor / 100).toLocaleString(undefined, { style: 'currency', currency: spend.currency })} per run
                </p>
              ) : (
                <p className="mt-1 text-xs text-ink-500">Spend authority: none</p>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-brand-500">Setup instructions</summary>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs text-ink-500">
                  {requirement.setup.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
                </ol>
              </details>
              {requirement.reactivation_on_change ? <p className="mt-2 text-[11px] text-ink-500">Identity or permission changes require reactivation.</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
