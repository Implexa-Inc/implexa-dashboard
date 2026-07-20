/**
 * <NeedsYouStrip /> , the actionable "needs you" items, each with one CTA.
 *
 * variant="home"  : grants, sign-ins, missed schedules — PLUS Judge blocks, which
 *                   nothing else on Home can show (Alerts polls
 *                   /scheduled-skills/live, which has no notion of a verdict).
 *                   Held runs are omitted here because Alerts already owns them.
 * variant="full"  : everything (the still-live /connections route).
 *
 * Server component , pure render over the loadNeedsYou() result.
 *
 * IT RENDERS EVEN WITH NOTHING TO LIST when the list could not be verified
 * complete. Returning null in that state hands the page back to its "Nothing
 * needs you" branch, which is the false all-clear this whole feature removes.
 */

import Link from 'next/link';
import type { NeedsYou } from '@/lib/needs-you';
import { attentionWarning, type AttentionItem } from '@/lib/attention';
import FixNowButton from './fix-now-button';

function Item({ title, detail, href, cta, warn = false }: {
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
 * A run-level card from the unified backend feed (Judge block or held run).
 *
 * It renders the agent's OWN account of what happened and the SPECIFIC action
 * named by the source — never a generic "Fix now". A Judge block that says
 * "cannot publish without a channel" and asks for information must not be
 * presented as "Review & approve": the user would open it expecting to skim a
 * result and find a question instead.
 */
function AttentionCard({ item }: { item: AttentionItem }) {
  const who = item.agentName || item.agentSlug || 'An agent';
  const href = item.runId ? `/runs/${item.runId}` : `/workflows/${item.agentSlug || ''}`;
  return (
    <div className="card flex items-center justify-between gap-3 border-amber-500/40">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-100 truncate">{who}</p>
        <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">{item.whatHappened}</p>
        {item.actionDetail && (
          <p className="text-[11px] mt-1 text-ink-400">{item.actionDetail}</p>
        )}
      </div>
      <Link href={href} className="btn-outline text-xs px-3 py-1.5 flex-none">
        {item.primaryAction.label}
      </Link>
    </div>
  );
}

export default function NeedsYouStrip({
  data,
  variant = 'home',
  className = '',
}: {
  data: NeedsYou;
  variant?: 'home' | 'full';
  className?: string;
}) {
  const full = variant === 'full';
  const count = full ? data.total : data.homeCount;
  const warning = attentionWarning({ partial: data.partial, truncated: data.truncated, live: !data.partial });
  // An INCOMPLETE empty list still has something to say. Returning null here
  // would let the page fall through to its "Nothing needs you" state while a
  // source we never read might hold blocked work.
  if (count === 0 && !warning) return null;

  return (
    <section className={`space-y-3 ${className}`}>
      {variant === 'home' && (
        <h2 className="text-xs font-semibold text-ink-300 uppercase tracking-wide">Set up</h2>
      )}

      {warning && (
        <p
          role="status"
          className="text-xs text-amber-700 dark:text-amber-300 border border-amber-500/40 rounded-md px-3 py-2"
        >
          {warning}
        </p>
      )}

      {full && data.stalled.map((r) => (
        <Item
          key={`stalled-${r.id}`}
          warn
          title={`${r.name} — stuck mid-run`}
          detail="It started but stalled, most likely waiting on a permission prompt it can't answer unattended. Open Claude, approve (or deny) the prompt it's stuck on, and pre-approve that permission so the next run doesn't stall."
          href={`/workflows/${r.slug}`}
          cta="Open agent"
        />
      ))}

      {data.needGrant.map((a) => (
        <Item key={`grant-${a.slug}`} warn title={a.name} detail={a.reason} href={`/workflows/${a.slug}/activate`} cta="Grant" />
      ))}

      {data.signIns.map((s) => (
        <Item
          key={`signin-${s.domain}`}
          title={`${s.label || s.domain} needs a sign-in`}
          detail={`${s.who} ${s.count === 1 ? 'needs' : 'need'} ${s.domain}, but you're signed out. Sign in once on the agent's setup.`}
          href={`/workflows/${encodeURIComponent(s.fixSlug)}/activate`}
          cta="Set up"
        />
      ))}

      {/* From the one backend read. Replaces the old hand-rolled approvals list,
          which knew only about review_status='pending' and described every one of
          them as an approval.
          full : Judge blocks + held runs (this page is the whole picture).
          home : Judge blocks only — Alerts already owns held runs there. */}
      {(full ? data.attentionItems : data.homeAttention).map((it) => (
        <AttentionCard key={it.attentionId} item={it} />
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
    </section>
  );
}
