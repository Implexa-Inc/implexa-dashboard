'use client';

/**
 * <TodayFeed /> — the ONE "what needs me?" surface on Home.
 *
 * WHAT THIS REPLACES (2026-07-24 Home redesign). Home stacked three separately
 * headed sections that all answered the same question with different keying:
 *
 *   Alerts    (<RunningAgents alertsOnly/>) — per RUN, live-polled
 *   Set up    (<NeedsYouStrip variant="home"/>) — per AGENT / per ACCOUNT / per SCHEDULE
 *   Results   (<InboxList/>) — per RUN, server-rendered
 *
 * They were already deduped against each other by hand (the strip omits held runs
 * "because Alerts already owns them"), but the SHAPE was the problem: the reader
 * has to check three places to know whether anything needs them, and the page
 * could render its own "Nothing needs you" all-clear while a section above it
 * listed real work. A manager's desk answers that question once.
 *
 * So: one heading, one list, one all-clear. Live run-keyed items come from
 * <RunningAgents bare/> (which keeps its polling, its typed Manager diagnosis and
 * its inline actions); setup blockers — the things NO run represents — render
 * beneath them and link to the agent that owns the fix, per the JIT-connections
 * rule that sign-ins and grants are resolved on the agent's own setup card, never
 * in a global connections screen.
 *
 * WHY THIS IS A CLIENT COMPONENT: the all-clear is only honest if one thing knows
 * BOTH the server-known setup count and the live alert count. That was the exact
 * contradiction on the old page — a server-rendered "nothing needs you" sitting
 * under a client-rendered list of alerts. `liveCount` comes back from
 * <RunningAgents onCount>, so this component is the only thing that can say it.
 */

import { useState } from 'react';
import Link from 'next/link';
// TYPE-ONLY imports on purpose: lib/attention and lib/needs-you both reach
// lib/supabase/server (next/headers), which cannot be pulled into a client
// bundle. Types are erased at compile time; the `warning` VALUE is computed on
// the server and passed in as a prop for the same reason.
import type { NeedsYou } from '@/lib/needs-you';
import type { AttentionItem } from '@/lib/attention';
import RunningAgents from './running-agents';
import FixNowButton from './fix-now-button';
import JudgeReviewCard from './judge-review-dialog';

function Row({ title, detail, href, cta, warn = false }: {
  title: string; detail: string; href: string; cta: string; warn?: boolean;
}) {
  return (
    <div className={`card flex items-center justify-between gap-3 ${warn ? 'border-amber-500/40' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-100 truncate">{title}</p>
        <p className={`text-xs mt-0.5 ${warn ? 'text-amber-700 dark:text-amber-300' : 'text-ink-500'}`}>{detail}</p>
      </div>
      <Link href={href} className="btn-outline text-xs px-3 py-1.5 flex-none">{cta}</Link>
    </div>
  );
}

/**
 * A Judge block — the one run-keyed item <RunningAgents> genuinely cannot show
 * (it polls /scheduled-skills/live, which has no notion of a verdict). It renders
 * its own dialog, which executes the typed action rather than linking away.
 */
function JudgeRow({ item }: { item: AttentionItem }) {
  return <JudgeReviewCard item={item} />;
}

export default function TodayFeed({ data, warning, className = '' }: {
  data: NeedsYou;
  /** attentionWarning(...) computed by the server page — see the import note above. */
  warning: string | null;
  className?: string;
}) {
  const [liveCount, setLiveCount] = useState(0);

  const setupCount = data.needGrant.length + data.signIns.length + data.missed.length + data.homeAttention.length;
  const nothingAtAll = setupCount === 0 && liveCount === 0;

  return (
    <section className={className}>
      <h2 className="text-xs font-semibold text-ink-300 uppercase tracking-wide mb-3">Today</h2>

      {/* An unverifiable list is NOT an empty one. When a source could not be read
          this says so instead of letting the all-clear below imply everything is
          fine — the rule lib/attention.ts exists to enforce. */}
      {warning && (
        <p
          role="status"
          className="text-xs text-amber-700 dark:text-amber-300 border border-amber-500/40 rounded-md px-3 py-2 mb-3"
        >
          {warning}
        </p>
      )}

      {/* Live, run-keyed: held for approval, needs attention (with the Manager's
          own diagnosis), failed, queued, and a just-finished receipt. */}
      <RunningAgents alertsOnly bare onCount={setLiveCount} />

      {(setupCount > 0) && (
        <div className={`space-y-3 ${liveCount > 0 ? 'mt-3' : ''}`}>
          {/* Judge verdicts that need a person — actioned in place. */}
          {data.homeAttention.map((it) => (
            <JudgeRow key={it.attentionId} item={it} />
          ))}

          {data.needGrant.map((a) => (
            <Row key={`grant-${a.slug}`} warn title={a.name} detail={a.reason}
              href={`/workflows/${a.slug}/activate`} cta="Grant" />
          ))}

          {data.signIns.map((s) => (
            <Row
              key={`signin-${s.domain}`}
              title={`${s.label || s.domain} needs a sign-in`}
              detail={`${s.who} ${s.count === 1 ? 'needs' : 'need'} ${s.domain}, but you're signed out. Sign in once on the agent's setup.`}
              href={`/workflows/${encodeURIComponent(s.fixSlug)}/activate`}
              cta="Set up"
            />
          ))}

          {data.missed.map((m) => (
            <div key={`missed-${m.id}`} className="card flex items-center justify-between gap-3 border-amber-500/40">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-100 truncate">{m.name}</p>
                <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">
                  {m.neverArmed
                    ? `Scheduled for ${m.when}, but it hasn't started running yet. Tap Start (keep the Claude app open) and it runs on its own from then on.`
                    : m.failed
                    ? 'Its schedule is marked failed. Tap Fix now and it re-runs on its own.'
                    : `Missed its schedule (${m.when}). Tap Fix now — it re-runs on its own and the result lands on Home.`}
                </p>
                <Link href={`/workflows/${m.slug}`} className="text-[11px] text-ink-500 hover:text-ink-300 hover:underline mt-1 inline-block">
                  Open agent details
                </Link>
              </div>
              <FixNowButton slug={m.slug} name={m.name} claudeTaskId={m.claudeTaskId} neverArmed={m.neverArmed} />
            </div>
          ))}
        </div>
      )}

      {/* The all-clear, and the ONLY place on Home that may claim it. Requires
          BOTH counts to be zero AND the read to have been verifiable. */}
      {nothingAtAll && !warning && (
        <div className="card p-6 text-center">
          <div className="text-2xl mb-2" aria-hidden="true">✓</div>
          <p className="text-ink-100 font-medium">Nothing needs you right now.</p>
          <p className="text-ink-400 text-sm mt-1">
            Your agents run on their own. Anything that needs a decision shows up here.
          </p>
        </div>
      )}
    </section>
  );
}
