/**
 * Public share preview at /s/[token].
 *
 * No auth required to view the preview. Anyone with the URL can see the
 * skill content, outcome stats, and a gate banner explaining who can install.
 * Install button routes to /s/[token]/install which is auth-gated.
 *
 * Server-rendered so social previews work + page is fast.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createClient } from '@/lib/supabase/server';
import InstallCta from './install-cta';

import 'highlight.js/styles/github-dark.css';
import { Logo } from '@/components/logo';

export const dynamic = 'force-dynamic';

type SharePreview = {
  token: string;
  skill: {
    slug: string;
    name: string;
    description: string;
    contentPreview: string;
    contentLength: number;
    tags?: string[];
    version: number;
    usageCount: number;
    uniqueUsers: number;
    attributedOutcomes: number;
    attributedValueUsd: number;
  };
  sharedBy: {
    orgId: string;
    userName: string | null;
    message: string | null;
    sharedAt: string;
  };
  gate: {
    shareMode: 'team' | 'public';
    allowedEmailDomain: string | null;
    gateDescription: string;
  };
  stats: { viewCount: number; installCount: number };
};

async function fetchPreview(token: string): Promise<SharePreview | { notFound: true } | { expired: true } | { error: string }> {
  const base = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'http://localhost:8001').replace(/\/$/, '');
  const res = await fetch(`${base}/api/v2/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) return { notFound: true };
  if (res.status === 410) return { expired: true };
  if (!res.ok) return { error: data.error || `Request failed (${res.status})` };
  return data as SharePreview;
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatUsd(n: number) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export default async function SharePreviewPage({ params }: { params: { token: string } }) {
  const data = await fetchPreview(params.token);

  if ('notFound' in data) notFound();

  if ('expired' in data) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md card text-center">
          <h1 className="text-2xl font-semibold mb-2">Link expired</h1>
          <p className="text-ink-500 text-sm">This share link is no longer active. Ask whoever sent it for a fresh one.</p>
        </div>
      </main>
    );
  }

  if ('error' in data) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md card text-center">
          <h1 className="text-2xl font-semibold mb-2">Couldn't load this share</h1>
          <p className="text-ink-500 text-sm">{data.error}</p>
        </div>
      </main>
    );
  }

  const { skill, sharedBy, gate, stats } = data;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAuthed = !!user;

  return (
    <main className="min-h-screen px-4 py-10">
      {/* Top nav */}
      <header className="max-w-3xl mx-auto flex items-center justify-between mb-10">
        <Link href="/" className="inline-flex items-center text-ink-50"><Logo height={20} /></Link>
        {isAuthed
          ? <Link href="/skills" className="text-sm text-ink-200 hover:underline">Your skills →</Link>
          : <Link href="/signup" className="text-sm text-brand-500 hover:underline">Sign in / Sign up</Link>}
      </header>

      <div className="max-w-3xl mx-auto">
        {/* Hero */}
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wide text-ink-400 mb-2">
            {sharedBy.userName || 'Someone'} shared a skill {timeAgo(sharedBy.sharedAt)}
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-ink-50">{skill.name}</h1>
          <p className="text-ink-200 mt-3 leading-relaxed">{skill.description}</p>

          {sharedBy.message && (
            <blockquote className="mt-4 border-l-4 border-brand-500 pl-4 italic text-ink-200">
              "{sharedBy.message}"
            </blockquote>
          )}
        </div>

        {/* Outcome stats — the viral hook */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Stat label="Used" value={`${skill.usageCount}×`} />
          <Stat label="Unique users" value={`${skill.uniqueUsers || 0}`} />
          <Stat label="Outcomes" value={`${skill.attributedOutcomes}`} />
          <Stat label="Value attributed" value={formatUsd(skill.attributedValueUsd)} highlight={skill.attributedValueUsd > 0} />
        </div>

        {/* Gate banner */}
        <div className={`card mb-6 border-l-4 ${gate.shareMode === 'team' ? '!border-l-brand-500' : '!border-l-ink-600'}`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className={`text-xs uppercase tracking-wide font-medium mb-1 ${gate.shareMode === 'team' ? 'text-brand-500' : 'text-ink-300'}`}>
                {gate.shareMode === 'team' ? '🔒 Team-only link' : '🌐 Public link'}
              </div>
              <p className="text-sm text-ink-200">{gate.gateDescription}</p>
            </div>
            <InstallCta token={data.token} isAuthed={isAuthed} gate={gate} />
          </div>
        </div>

        {/* Skill content preview */}
        <div className="card">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-medium text-ink-50">What this skill does</h2>
            <div className="text-xs text-ink-400">v{skill.version} · {skill.contentLength} chars</div>
          </div>
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {skill.contentPreview}
            </ReactMarkdown>
          </div>
          {skill.contentLength > skill.contentPreview.length && (
            <div className="mt-4 text-xs text-ink-400 italic">
              Preview truncated. Install the skill to see the full content.
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-10 text-center text-xs text-ink-400">
          <p>
            Powered by <Link href="/" className="text-brand-500 hover:underline font-medium">Implexa</Link> · Skill recording for any AI session
          </p>
          <p className="mt-2">
            {stats.viewCount} {stats.viewCount === 1 ? 'view' : 'views'} · {stats.installCount} {stats.installCount === 1 ? 'install' : 'installs'}
          </p>
        </footer>
      </div>
    </main>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card !p-3 text-center ${highlight ? '!border-success-400/40' : ''}`}>
      <div className={`text-xl font-semibold tabular-nums ${highlight ? 'text-success-400' : 'text-ink-50'}`}>{value}</div>
      <div className="text-xs text-ink-400 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

// SEO / share previews
export async function generateMetadata({ params }: { params: { token: string } }) {
  const data = await fetchPreview(params.token);
  if ('notFound' in data || 'expired' in data || 'error' in data) {
    return { title: 'Implexa — share link', description: 'A shared Implexa skill.' };
  }
  return {
    title:       `${data.skill.name} — Implexa`,
    description: data.skill.description,
    openGraph: {
      title:       `${data.skill.name} — Implexa`,
      description: data.skill.description,
      type:        'website',
    },
    twitter: {
      card:        'summary_large_image',
      title:       `${data.skill.name} — Implexa`,
      description: data.skill.description,
    },
  };
}
