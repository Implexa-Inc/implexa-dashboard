import { BackendError, callBackend } from '@/lib/api';

export type DiscoveredAgent = {
  id: string;
  slug: string;
  name: string;
  job: string;
  builder: { id: string; name: string };
  ownership: 'Available' | 'Hired' | 'Owned';
  limitations: string;
  examples?: Array<{ title?: string | null; body?: string; format?: string }>;
  audience?: string | null;
  prerequisites?: string | null;
  trust?: Record<string, { status: string; count?: number }>;
  capabilities?: string[];
  permissions?: string[];
  requiredInputs?: { version: 1; fields: Array<{ key: string; label: string; description: string; kind: 'text' | 'choice' | 'file'; required: boolean; options?: string[] }> } | null;
  requirements?: { requirements: Array<{ id: string; requirement_type: string; required: boolean; permission_category: string; setup: { title: string; instructions: string[] } }> };
  version: { id: string; number: string; updatedAt: string };
  readiness: { state: 'Available' | 'Installed' | 'Needs setup' | 'Ready' | 'Update available' | 'Disabled' | 'Incompatible' | 'Blocked'; reason: string | null };
  primaryAction: 'View agent' | 'Use agent' | 'Finish setup';
  testedCompatibility: { executionEngines: string[] };
  update?: null | { fromVersion: string | null; toVersion: string; authorityDiff: { addedCapabilities: string[]; removedCapabilities: string[]; addedPermissions: string[]; removedPermissions: string[]; changesAuthority: boolean; broadensAuthority: boolean } };
  acquisition?: null | { id: string; pinnedVersionId: string; activeVersionId: string; lifecycle: 'installed' | 'disabled' | 'uninstalled' };
};

export type AgentDiscoveryResult =
  | { status: 'ready'; agents: DiscoveredAgent[] }
  | { status: 'unavailable'; agents: []; reason: string };

export async function listAgentDiscovery(jwt: string): Promise<AgentDiscoveryResult> {
  try {
    const response = await callBackend('/api/v2/agents/discovery', { jwt });
    return { status: 'ready', agents: Array.isArray(response?.agents) ? response.agents : [] };
  } catch (error) {
    return { status: 'unavailable', agents: [], reason: error instanceof Error ? error.message : 'Agent discovery is unavailable.' };
  }
}

export type AgentResumeResult =
  | { status: 'found'; agent: DiscoveredAgent }
  | { status: 'not_marketplace' }
  | { status: 'unavailable'; reason: string };

export async function getAgentResume(slug: string, jwt: string): Promise<AgentResumeResult> {
  try {
    const response = await callBackend(`/api/v2/agents/discovery/${encodeURIComponent(slug)}`, { jwt });
    return response?.agent ? { status: 'found', agent: response.agent } : { status: 'unavailable', reason: 'Agent resume response was incomplete.' };
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) return { status: 'not_marketplace' };
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'Agent resume is unavailable.' };
  }
}
