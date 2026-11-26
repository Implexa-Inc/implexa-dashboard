import Link from 'next/link';
import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { agentSharePath, readSharedAgent, sharedAgentSetupPath } from '@/lib/agent-share';

export const dynamic = 'force-dynamic';
const load = cache(readSharedAgent);

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const result = await load(params.id);
  const robots = { index: false, follow: false };
  if (result.state !== 'ready') return { title: 'Shared agent · Tukido', robots };
  const title = `${result.agent.name} · Tukido`;
  const description = result.agent.description;
  return { title, description, robots, openGraph: { title, description, type: 'website' } };
}

export default async function SharedAgentPage({ params, searchParams }: {
  params: { id: string }; searchParams: { open?: string };
}) {
  const result = await load(params.id);
  if (result.state === 'missing') notFound();
  if (result.state !== 'ready') return (
    <main className="mx-auto max-w-xl px-6 py-20">
      <h1 className="text-3xl font-medium">Agent preview unavailable</h1>
      <p className="mt-3 text-reading">Refresh to try again.</p>
    </main>
  );

  const { agent } = result;
  const { data: { session } } = await createClient().auth.getSession();
  if (session?.user && searchParams.open === '1') redirect(sharedAgentSetupPath(agent));
  const href = session?.user
    ? `/get-app?agent=${agent.id}`
    : `/login?next=${encodeURIComponent(agentSharePath(agent.id))}`;

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <Link href="/" className="text-lg font-medium text-ink-400">Tukido</Link>
      <section className="mt-6 rounded-2xl border border-ink-700 p-8">
        <h1 className="text-4xl font-medium tracking-tight">{agent.name}</h1>
        {agent.description && <p className="mt-4 text-reading text-ink-400">{agent.description}</p>}
        <Link href={href} className="btn-primary mt-7 inline-flex">
          {session?.user ? 'Set up this agent' : 'Sign in to use this agent'}
        </Link>
      </section>
    </main>
  );
}
