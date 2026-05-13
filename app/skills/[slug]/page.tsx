/**
 * Skill detail at /skills/[slug].
 * Renders the SKILL.md content, structured fields, share + activate buttons.
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createClient } from '@/lib/supabase/server';
import SkillActions from './actions';

import 'highlight.js/styles/github-dark.css';

export const dynamic = 'force-dynamic';

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

export default async function SkillDetailPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // RLS ensures we only see our own org's skills (+ system Playbooks)
  const { data: skill } = await supabase
    .from('org_skills')
    .select('*')
    .eq('slug', params.slug)
    .in('organization_id', [session.user.id, SYSTEM_ORG_ID])           // RLS-equivalent filter
    .maybeSingle();

  // Above filter is a sanity check; RLS does the real gating. Re-query without org filter
  // if the above returns nothing — covers the case where the user is part of an org_id
  // different from their user_id.
  const { data: actualSkill } = skill
    ? { data: skill }
    : await supabase.from('org_skills').select('*').eq('slug', params.slug).maybeSingle();

  if (!actualSkill) notFound();

  const isSystem = actualSkill.organization_id === SYSTEM_ORG_ID;
  const inputs         = Array.isArray(actualSkill.inputs)          ? actualSkill.inputs          : [];
  const decisionPoints = Array.isArray(actualSkill.decision_points) ? actualSkill.decision_points : [];
  const outputContract = actualSkill.output_contract || {};
  const outcomeSignal  = actualSkill.outcome_signal  || {};
  const stats          = actualSkill.outcome_stats   || {};

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <nav className="text-sm text-ink-500 mb-6">
          <Link href="/skills" className="hover:underline">← All skills</Link>
        </nav>

        {/* Header */}
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-0.5 rounded-full uppercase tracking-wide ${
                actualSkill.status === 'active' ? 'bg-brand-500 text-white' :
                actualSkill.status === 'draft'  ? 'bg-ink-800 text-ink-200' :
                'bg-ink-800 text-ink-500'}`}>
                {actualSkill.status}
              </span>
              {isSystem && <span className="text-xs px-2 py-0.5 rounded-full bg-ink-800 text-ink-200">Base Playbook</span>}
              <span className="text-xs text-ink-500 uppercase tracking-wide">{actualSkill.scope} · v{actualSkill.version}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{actualSkill.name}</h1>
            <code className="text-xs text-ink-500 font-mono">{actualSkill.slug}</code>
            <p className="text-ink-200 mt-3">{actualSkill.description}</p>
          </div>

          <SkillActions
            jwt={session.access_token}
            slug={actualSkill.slug}
            id={actualSkill.id}
            currentStatus={actualSkill.status}
            isSystem={isSystem}
          />
        </header>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Used" value={`${actualSkill.usage_count || 0}×`} />
          <Stat label="Unique users" value={`${actualSkill.unique_users || 0}`} />
          <Stat label="Outcomes" value={`${stats.attributedOutcomes || 0}`} highlight={stats.attributedOutcomes > 0} />
          <Stat label="Value" value={stats.attributedValueUsd ? `$${Math.round(stats.attributedValueUsd / 1000)}K` : '$0'} highlight={stats.attributedValueUsd > 0} />
        </div>

        {/* Trigger phrases */}
        {Array.isArray(actualSkill.trigger_phrases) && actualSkill.trigger_phrases.length > 0 && (
          <div className="card mb-6">
            <div className="text-xs uppercase tracking-wide text-ink-500 mb-2">Trigger phrases</div>
            <div className="flex flex-wrap gap-2">
              {actualSkill.trigger_phrases.map((p: string) => (
                <span key={p} className="px-2 py-1 bg-ink-800 rounded text-xs text-ink-200">{p}</span>
              ))}
            </div>
          </div>
        )}

        {/* Tabs — content + structure */}
        <div className="card">
          <h2 className="text-lg font-medium mb-4">SKILL.md content</h2>
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {actualSkill.content || '(no content)'}
            </ReactMarkdown>
          </div>
        </div>

        {/* Structured fields */}
        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <div className="card">
            <h3 className="text-sm font-medium mb-3 uppercase tracking-wide text-ink-500">Inputs ({inputs.length})</h3>
            {inputs.length === 0 ? (
              <p className="text-sm text-ink-500 italic">No structured inputs.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {inputs.map((i: any, idx: number) => (
                  <li key={idx} className="border-l-2 border-brand-500 pl-3">
                    <code className="font-mono text-xs text-brand-600">{i.name}</code>
                    <span className="text-xs text-ink-500 ml-2">{i.type}{i.required ? ' · required' : ''}</span>
                    <div className="text-xs text-ink-200 mt-0.5">{i.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h3 className="text-sm font-medium mb-3 uppercase tracking-wide text-ink-500">Output contract</h3>
            {outputContract.summary ? (
              <div className="text-sm space-y-2">
                <div><strong className="text-xs text-ink-500 uppercase">Format:</strong> {outputContract.format || '—'}</div>
                <div className="text-ink-200">{outputContract.summary}</div>
                {Array.isArray(outputContract.qualityChecks) && outputContract.qualityChecks.length > 0 && (
                  <div>
                    <div className="text-xs text-ink-500 uppercase mt-2">Quality checks:</div>
                    <ul className="text-xs text-ink-200 list-disc pl-4 mt-1 space-y-0.5">
                      {outputContract.qualityChecks.map((c: string, i: number) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : <p className="text-sm text-ink-500 italic">No output contract defined.</p>}
          </div>

          <div className="card">
            <h3 className="text-sm font-medium mb-3 uppercase tracking-wide text-ink-500">Decision points ({decisionPoints.length})</h3>
            {decisionPoints.length === 0 ? (
              <p className="text-sm text-ink-500 italic">No conditional logic — fully deterministic skill.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {decisionPoints.map((d: any, idx: number) => (
                  <li key={idx} className="border-l-2 border-brand-400 pl-3">
                    <div className="text-xs font-medium text-brand-600">{d.atStep}</div>
                    <div className="text-xs text-ink-200">{d.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h3 className="text-sm font-medium mb-3 uppercase tracking-wide text-ink-500">Outcome signal</h3>
            {outcomeSignal.metric ? (
              <div className="text-sm space-y-2">
                <div>
                  <code className="font-mono text-xs text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">{outcomeSignal.metric}</code>
                  {outcomeSignal.target && <span className="text-xs text-ink-500 ml-2">target {outcomeSignal.target}</span>}
                </div>
                <div className="text-xs text-ink-500">Source: {outcomeSignal.source || 'manual'}</div>
                <div className="text-xs text-ink-200">{outcomeSignal.description}</div>
              </div>
            ) : <p className="text-sm text-ink-500 italic">No outcome signal — attribution not configured.</p>}
          </div>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card !p-3 ${highlight ? '!border-success-400/40' : ''}`}>
      <div className={`text-xl font-semibold tabular-nums ${highlight ? 'text-success-400' : 'text-ink-50'}`}>{value}</div>
      <div className="text-xs text-ink-400 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
