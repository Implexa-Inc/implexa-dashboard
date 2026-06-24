/**
 * Public Run Card at /s/run/[token] — the verified, shareable run outcome.
 *
 * No auth to view. Shows what the agent did, the scrubbed deliverable, the trust
 * line ("ran inside the owner's own Claude/Codex, never touched their
 * credentials"), the agent's public grade (if it clears the floor), and a one-tap
 * "run this agent in your subscription" CTA. The growth loop's artifact.
 *
 * Server-rendered so social previews work + it's fast and indexable (AEO).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Logo } from '@/components/logo';

import 'highlight.js/styles/github-dark.css';

export const dynamic = 'force-dynamic';

const API = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');

type Card = {
  token: string;
  headline: string;
  output: string;
  stepsState: { index: number; label: string; status: string }[] | null;
  ranAt: string | null;
  skillSlug: string;
  creatorName: string | null;
  grade: { rate: number; label: string; runs: number } | null;
  trustLine: string;
  viewCount: number;
};

function humanize(slug: string) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function RunCardPage({ params }: { params: { token: string } }) {
  let card: Card | null = null;
  try {
    const res = await fetch(`${API}/api/v2/share/run/${encodeURIComponent(params.token)}`, { cache: 'no-store' });
    if (res.ok) {
      const b = await res.json();
      if (b.ok) card = b.card as Card;
    }
  } catch { /* fall through to notFound */ }
  if (!card) notFound();

  const agentName = humanize(card.skillSlug || 'agent');
  const adoptHref = `/signup?intent=adopt&agent=${encodeURIComponent(card.skillSlug)}`;
  const pct = card.grade ? Math.round(card.grade.rate * 100) : null;

  return (
    <main className="min-h-screen bg-ink-950 text-ink-100 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <Logo />
          <Link href="/signup" className="text-xs text-ink-400 hover:text-ink-200">Build your own →</Link>
        </header>

        {/* The outcome */}
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-5">
          <div className="flex items-center gap-2 text-[11px] text-ink-500 mb-2">
            <span className="text-emerald-400">●</span> Agent run
            {card.creatorName ? <span>· by {card.creatorName}</span> : null}
            {card.ranAt ? <span>· {new Date(card.ranAt).toLocaleDateString()}</span> : null}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-50">{card.headline}</h1>
          <p className="text-sm text-ink-400 mt-1">
            from the <span className="font-mono text-ink-300">{agentName}</span> agent
            {pct !== null && card.grade ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/[0.07] px-2 py-0.5 text-[11px] text-emerald-300">
                ✓ delivered {pct}% · {card.grade.runs} real runs
              </span>
            ) : null}
          </p>

          {/* What it did */}
          {card.stepsState && card.stepsState.length > 0 && (
            <ol className="mt-4 space-y-1.5 text-sm">
              {card.stepsState.map((s) => (
                <li key={s.index} className="flex items-start gap-2 text-ink-300">
                  <span className={s.status === 'done' ? 'text-emerald-400' : 'text-ink-600'}>
                    {s.status === 'done' ? '✓' : '•'}
                  </span>
                  <span>{s.label}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* The deliverable (scrubbed) */}
        <div className="mt-4 rounded-xl border border-ink-800 bg-ink-900/20 p-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-3">What it produced</div>
          <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-ink-950 prose-pre:border prose-pre:border-ink-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.output}</ReactMarkdown>
          </div>
        </div>

        {/* Trust line */}
        <p className="mt-4 text-xs text-ink-400 flex items-start gap-2">
          <span aria-hidden>🔒</span>
          <span>{card.trustLine}</span>
        </p>

        {/* The fork CTA — the loop */}
        <div className="mt-6 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] p-5 text-center">
          <p className="text-sm text-ink-200 font-medium">Want this running for you?</p>
          <p className="text-xs text-ink-400 mt-1">
            Run this agent inside the Claude or Codex you already pay for. It never touches your credentials, and it&apos;s free to use with the tools you have.
          </p>
          <Link href={adoptHref} className="btn-success inline-block mt-3 px-5 py-2 text-sm">
            Run this agent in your subscription
          </Link>
        </div>

        <p className="mt-6 text-center text-[11px] text-ink-600">
          Built and graded on real runs by Implexa · {card.viewCount} view{card.viewCount === 1 ? '' : 's'}
        </p>
      </div>
    </main>
  );
}
