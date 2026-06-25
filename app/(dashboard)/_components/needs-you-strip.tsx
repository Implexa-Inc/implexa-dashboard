/**
 * <NeedsYouStrip /> , the actionable "needs you" items, each with one CTA.
 *
 * variant="home"  : the agent/account-level items only (grants, sign-ins, missed
 *                   schedules). Reviews + stalled runs are already the Home todo +
 *                   attention banner, so they are omitted to avoid double-listing.
 * variant="full"  : everything (the still-live /connections route).
 *
 * Server component , pure render over the loadNeedsYou() result.
 */

import Link from 'next/link';
import type { NeedsYou } from '@/lib/needs-you';
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
  if (count === 0) return null;

  return (
    <section className={`space-y-3 ${className}`}>
      {variant === 'home' && (
        <h2 className="text-xs font-semibold text-ink-300 uppercase tracking-wide">Set up</h2>
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

      {full && data.approvals.map((a) => (
        <Item
          key={`approval-${a.id}`}
          warn
          title={`${a.name} — your approval needed`}
          detail="It paused at a human-approval gate. Read what it produced, then approve to let it finish the held step."
          href={`/runs/${a.id}`}
          cta="Review & approve"
        />
      ))}

      {data.missed.map((m) => (
        <div key={`missed-${m.id}`} className="card flex items-center justify-between gap-3 border-amber-500/40">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-100 truncate">{m.name}</p>
            <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">
              {m.neverArmed
                ? `Scheduled for ${m.when}, but it hasn't started running yet. Open Claude once and it'll run on its own from then on.`
                : m.failed
                ? 'Its schedule is marked failed. Run it now in Claude to get it going again.'
                : `Missed its schedule (${m.when}). Run it now in Claude — it lands on the routine so you can watch.`}
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
