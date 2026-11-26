export function isAgentShareId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
}

export function agentSharePath(id: string) {
  return `/s/agent/${id}`;
}

type SharedAgent = { id: string; slug: string; source: string; name: string; description: string };

export async function readSharedAgent(id: string): Promise<
  { state: 'ready'; agent: SharedAgent } | { state: 'missing' | 'unavailable' }
> {
  if (!isAgentShareId(id)) return { state: 'missing' };
  const base = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/api/v2/share/agent/${id}`, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return { state: 'missing' };
    if (!response.ok) return { state: 'unavailable' };
    const body = await response.json();
    const agent = body?.agent;
    if (body?.ok !== true || agent?.id !== id
        || ![agent.slug, agent.source, agent.name].every(value => typeof value === 'string' && value.trim())
        || typeof agent.description !== 'string') return { state: 'unavailable' };
    return { state: 'ready', agent };
  } catch {
    return { state: 'unavailable' };
  }
}

export function sharedAgentSetupPath(agent: SharedAgent): string {
  const query = new URLSearchParams({ source: agent.source, shared: agent.id, tab: 'setup' });
  return `/workflows/${encodeURIComponent(agent.slug)}?${query}`;
}
