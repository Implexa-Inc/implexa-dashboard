/**
 * /skills/[slug]/raw-capture — the creator's view of the full underlying
 * demonstration trace that produced this skill.
 *
 * Visible ONLY to the user who recorded the demo. Other org members see
 * the synthesized SKILL.md but not this raw data.
 *
 * Five sections:
 *   1. Header — intent, duration, status, "Back to skill"
 *   2. 💬 Conversation log (from UserPromptSubmit + Stop hooks)
 *   3. 🔧 Tool calls (from PostToolUse hook + Implexa MCP auto-logging)
 *   4. 📝 Manual notes (from record_demo_note calls)
 *   5. ❓ Interview Q&A (Haiku-generated questions + creator's answers)
 *   6. 📄 Free-form notes (the "anything else?" capture)
 */

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';

export const dynamic = 'force-dynamic';

type RawCapture = {
  skill: { id: string; slug: string; name: string };
  noDemo?: boolean;
  message?: string;
  demo?: {
    id:              string;
    status:          string;
    startedAt:       string;
    endedAt:         string | null;
    capturedAt:      string | null;
    durationSec:     number | null;
    initialIntent:   string | null;
    proposedName:    string | null;
    traceLog:        Array<any>;
    conversationLog: Array<any>;
    interview:       Array<any>;
    freeFormNotes:   string | null;
    interviewModel:  string | null;
  };
};

export default async function RawCapturePage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  let data: RawCapture | { error: string };
  try {
    data = await callBackend(`/api/v2/skills/${encodeURIComponent(params.slug)}/raw-capture`, {
      jwt: session.access_token,
    });
  } catch (err: any) {
    // Forbidden = current user is not the creator; treat as 404-style
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <nav className="text-xs text-ink-500 mb-4">
            <Link href={`/skills/${params.slug}`} className="hover:underline">← Back to skill</Link>
          </nav>
          <div className="card">
            <h1 className="text-2xl font-semibold text-ink-50 mb-2">Can&apos;t show raw capture</h1>
            <p className="text-sm text-ink-300">{err.message || 'Only the original demo creator can view raw capture data.'}</p>
          </div>
        </div>
      </main>
    );
  }

  if ('error' in data) {
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <nav className="text-xs text-ink-500 mb-4">
            <Link href={`/skills/${params.slug}`} className="hover:underline">← Back to skill</Link>
          </nav>
          <div className="card text-sm text-ink-300">{data.error}</div>
        </div>
      </main>
    );
  }

  // Skill exists but no demo (was captured via direct save)
  if (data.noDemo) {
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <nav className="text-xs text-ink-500 mb-4">
            <Link href={`/skills/${params.slug}`} className="hover:underline">← Back to {data.skill.name}</Link>
          </nav>
          <div className="card">
            <h1 className="text-2xl font-semibold text-ink-50 mb-2">No raw capture available</h1>
            <p className="text-sm text-ink-300">{data.message}</p>
          </div>
        </div>
      </main>
    );
  }

  const { skill, demo } = data as Required<Pick<RawCapture, 'skill'>> & { demo: NonNullable<RawCapture['demo']> };
  if (!demo) notFound();

  const toolCalls = (demo.traceLog || []).filter((e: any) => e.source === 'tool' || (!e.source && e.toolName));
  const manualNotes = (demo.traceLog || []).filter((e: any) => e.source === 'note' || (e.noteText && !e.source));

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <nav className="text-xs text-ink-500 mb-4">
          <Link href={`/skills/${params.slug}`} className="hover:underline">← Back to {skill.name}</Link>
        </nav>

        {/* Header */}
        <header className="mb-8">
          <div className="text-xs uppercase tracking-wider text-ink-400 mb-2">Raw capture</div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">{skill.name}</h1>
          <p className="text-sm text-ink-300 mt-2 leading-relaxed">
            Everything captured during your demo recording — verbatim. <strong>Only you can see this.</strong>{' '}
            Your teammates see the synthesized SKILL.md, not this raw view.
          </p>
        </header>

        {/* Privacy banner */}
        <div className="card !p-3 !bg-brand-50 !border-brand-500/30 mb-6 text-xs text-ink-300 flex items-start gap-2">
          <span>🔒</span>
          <span>
            This data is <strong>pre-PII-scrub</strong> and creator-only. The version other org members see in the SKILL.md had URLs, emails, and identifiers redacted by Haiku. Use this raw view to audit what was actually captured.
          </span>
        </div>

        {/* Demo metadata */}
        <section className="card mb-8">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-400 mb-1">Intent</div>
              <div className="text-sm text-ink-100 leading-relaxed">{demo.initialIntent || '(none)'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-400 mb-1">Duration</div>
              <div className="text-sm text-ink-100 tabular-nums">{formatDuration(demo.durationSec)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-400 mb-1">Status</div>
              <div className="text-sm text-ink-100 capitalize">{demo.status}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-400 mb-1">Started</div>
              <div className="text-sm text-ink-100 tabular-nums">{new Date(demo.startedAt).toLocaleString()}</div>
            </div>
          </div>
        </section>

        {/* Summary counts */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <CountStat label="Tool calls"        value={toolCalls.length}   icon="🔧" />
          <CountStat label="Conversation turns" value={demo.conversationLog.length} icon="💬" />
          <CountStat label="Manual notes"      value={manualNotes.length} icon="📝" />
          <CountStat label="Interview Q&A"     value={demo.interview.length} icon="❓" />
        </section>

        {/* Conversation log */}
        <Section title="Conversation log" icon="💬" count={demo.conversationLog.length}>
          {demo.conversationLog.length === 0 ? (
            <EmptyState text="No conversation turns captured. This usually means the UserPromptSubmit + Stop hooks weren't firing during this recording." />
          ) : (
            <div className="space-y-3">
              {demo.conversationLog.map((turn: any, i: number) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 ${
                    turn.role === 'user'
                      ? 'bg-brand-50/40 dark:bg-brand-500/10 border border-brand-500/30'
                      : 'bg-ink-900/50 border border-ink-700'
                  }`}
                >
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-xs font-medium text-ink-100">
                      {turn.role === 'user' ? '👤 You' : turn.role === 'assistant' ? '🤖 Claude' : `🔧 ${turn.role}`}
                      {turn.turnIndex != null && <span className="ml-2 text-ink-400 font-normal">turn {turn.turnIndex}</span>}
                    </span>
                    {turn.occurredAt && (
                      <span className="text-[10px] text-ink-400 tabular-nums">{new Date(turn.occurredAt).toLocaleTimeString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-ink-200 leading-relaxed whitespace-pre-wrap break-words">
                    {turn.content || '(empty)'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Tool calls */}
        <Section title="Tool calls" icon="🔧" count={toolCalls.length}>
          {toolCalls.length === 0 ? (
            <EmptyState text="No tool calls captured. PostToolUse hook may not have fired during this recording." />
          ) : (
            <div className="space-y-2">
              {toolCalls.map((tc: any, i: number) => (
                <div key={i} className="rounded-lg p-3 bg-ink-900/50 border border-ink-700">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                    <code className="text-xs font-mono text-success-700 dark:text-success-400 break-all">{tc.toolName}</code>
                    <div className="text-[10px] text-ink-400 tabular-nums flex gap-2">
                      {tc.durationMs != null && <span>{tc.durationMs}ms</span>}
                      {tc.occurredAt && <span>{new Date(tc.occurredAt).toLocaleTimeString()}</span>}
                    </div>
                  </div>
                  {tc.toolArgs && Object.keys(tc.toolArgs).length > 0 && (
                    <Field label="args">
                      <pre className="text-[11px] text-ink-200 bg-ink-950 rounded p-2 overflow-x-auto max-h-48 font-mono">{JSON.stringify(tc.toolArgs, null, 2)}</pre>
                    </Field>
                  )}
                  {tc.resultPreview && (
                    <Field label="result preview">
                      <div className="text-[11px] text-ink-200 bg-ink-950 rounded p-2 overflow-x-auto max-h-32 font-mono whitespace-pre-wrap break-words">
                        {tc.resultPreview}
                      </div>
                    </Field>
                  )}
                  {tc.decisions && tc.decisions.length > 0 && (
                    <Field label="decisions">
                      <pre className="text-[11px] text-ink-300 font-mono">{JSON.stringify(tc.decisions, null, 2)}</pre>
                    </Field>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Manual notes */}
        <Section title="Manual notes" icon="📝" count={manualNotes.length}>
          {manualNotes.length === 0 ? (
            <EmptyState text="No manual notes. Claude calls record_demo_note when hooks aren't firing — empty means hooks did the work automatically." />
          ) : (
            <div className="space-y-2">
              {manualNotes.map((note: any, i: number) => (
                <div key={i} className="rounded-lg p-3 bg-ink-900/50 border border-ink-700">
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <code className="text-xs font-mono text-accent-700 dark:text-accent-400">{note.toolName || 'note'}</code>
                    {note.occurredAt && (
                      <span className="text-[10px] text-ink-400 tabular-nums">{new Date(note.occurredAt).toLocaleTimeString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-ink-200 leading-relaxed whitespace-pre-wrap break-words">{note.noteText}</div>
                  {note.contextHint && (
                    <div className="text-[11px] text-ink-400 mt-1.5 truncate" title={note.contextHint}>
                      <span className="text-ink-500">↳ </span>
                      <code className="font-mono">{note.contextHint}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Interview Q&A */}
        <Section title="Interview Q&A" icon="❓" count={demo.interview.length}>
          {demo.interview.length === 0 ? (
            <EmptyState text="No interview yet — only present after the demo has been finalized." />
          ) : (
            <div className="space-y-3">
              {demo.interview.map((qa: any, i: number) => (
                <div key={i} className="rounded-lg p-3 bg-ink-900/50 border border-ink-700">
                  <div className="text-xs uppercase tracking-wider text-ink-400 mb-1">
                    Question {i + 1}
                    {qa.questionType && <span className="ml-2 text-ink-500">({qa.questionType})</span>}
                  </div>
                  <div className="text-sm text-ink-100 font-medium mb-3 leading-relaxed">{qa.question}</div>
                  <div className="text-xs uppercase tracking-wider text-ink-400 mb-1">Your answer</div>
                  <div className="text-sm text-ink-200 leading-relaxed whitespace-pre-wrap break-words">
                    {qa.answer || '(no answer)'}
                  </div>
                </div>
              ))}
            </div>
          )}
          {demo.interviewModel && (
            <div className="text-[10px] text-ink-400 mt-3">Generated by {demo.interviewModel}</div>
          )}
        </Section>

        {/* Free-form notes */}
        {demo.freeFormNotes && (
          <Section title="Free-form notes" icon="📄" count={null}>
            <div className="rounded-lg p-3 bg-ink-900/50 border border-ink-700 text-sm text-ink-200 leading-relaxed whitespace-pre-wrap break-words">
              {demo.freeFormNotes}
            </div>
          </Section>
        )}

        {/* Synthesized output link */}
        <section className="mt-12 card !bg-success-400/5 !border-success-400/30">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🪄</span>
            <div className="flex-1">
              <h2 className="text-sm font-medium text-ink-50 mb-1">→ Synthesized SKILL.md</h2>
              <p className="text-xs text-ink-300 leading-relaxed mb-2">
                Haiku turned all of the above into a structured, reusable skill. PII was scrubbed before saving.
              </p>
              <Link href={`/skills/${params.slug}`} className="text-xs text-brand-600 hover:underline font-medium">
                View the synthesized skill →
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Section({ title, icon, count, children }: { title: string; icon: string; count: number | null; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-base font-medium text-ink-50 mb-3 flex items-center gap-2">
        <span>{icon}</span>
        {title}
        {count != null && <span className="text-sm text-ink-400 font-normal">({count})</span>}
      </h2>
      {children}
    </section>
  );
}

function CountStat({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="card !p-3 text-center">
      <div className="text-2xl leading-none mb-1">{icon}</div>
      <div className="text-2xl font-semibold tabular-nums text-ink-50">{value}</div>
      <div className="text-[10px] text-ink-400 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="card !p-3 text-xs text-ink-400 italic">{text}</div>
  );
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export const metadata = {
  title: 'Raw capture — Implexa',
};
