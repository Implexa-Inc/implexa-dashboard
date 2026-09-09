import type { AgentRequirementsPayload } from './activation';

type ServiceRequirement = AgentRequirementsPayload['services'][number];

/**
 * Only positive evidence that this workflow requires an API key may raise the
 * blocking "Needs a key" card. A detected provider can instead be browser-
 * accessed, optional, or merely referenced while authoring a plan.
 */
export function missingRequiredApiKeys(services: ServiceRequirement[]): string[] {
  return services
    .filter((service) => service.apiKeyRequired === true && !service.keyOnMachine)
    .map((service) => service.name);
}
