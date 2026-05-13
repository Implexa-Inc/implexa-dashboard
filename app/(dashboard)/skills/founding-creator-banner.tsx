/**
 * Founding Creator banner — the activation primitive.
 *
 * Three states based on what the user has done so far:
 *
 *   🪙 Encourage    (default) — has not yet captured AND shared
 *   🔓 Activated    — has captured a NEW skill (not fork) AND shared at least once
 *
 * The unlock condition is detected from data already on the database — no
 * separate flag table needed yet. We may persist it explicitly later for
 * speed + email triggers, but for v0 the query is cheap.
 *
 * State derives from:
 *   has_captured = an org_skills row authored by the user
 *                  (scope IN ('org','private'), forked_from_skill_id IS NULL)
 *   has_shared   = a share_tokens row created by the user
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function FoundingCreatorBanner({ userId }: { userId: string }) {
  const supabase = createClient();

  // Has the user captured a NEW (non-fork) skill?
  const { data: capturedRow } = await supabase
    .from('org_skills')
    .select('id, slug')
    .eq('created_by->>userId', userId)
    .is('forked_from_skill_id', null)
    .in('scope', ['org', 'private'])
    .limit(1)
    .maybeSingle();
  const hasCaptured = !!capturedRow;

  // Has the user created at least one share token?
  const { data: shareRow } = await supabase
    .from('share_tokens')
    .select('id, token')
    .eq('created_by_user_id', userId)
    .limit(1)
    .maybeSingle();
  const hasShared = !!shareRow;

  // Unlocked state
  if (hasCaptured && hasShared) {
    return (
      <section className="card !bg-gradient-to-r !from-success-400/15 !to-brand-500/10 !border-success-400/50 mb-8">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0" aria-hidden="true">🏆</div>
          <div className="flex-1">
            <div className="flex items-baseline gap-2 flex-wrap mb-1">
              <h2 className="text-lg font-medium text-ink-50">You&apos;re a Founding Creator</h2>
              <span className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400">
                Unlocked
              </span>
            </div>
            <p className="text-sm text-ink-200 leading-relaxed mb-3">
              You captured your first skill <em>and</em> shared it — the killer feature of
              Implexa. You unlocked: <strong>unlimited captures (no 5/month cap)</strong>, the
              Founding Creator badge on every skill you share, and your <strong>first seat on Pro free forever</strong> when we launch the Pro tier.
            </p>
            <div className="flex flex-wrap gap-3 items-baseline">
              <Link href="/pricing" className="text-xs text-brand-600 hover:underline font-medium">
                See the Pro plan →
              </Link>
              <span className="text-xs text-ink-400">
                Capture another skill to grow your library.
              </span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Encouragement state — show the 2-step progress
  return (
    <section className="card !bg-brand-50 !border-brand-500/30 mb-8">
      <div className="flex items-start gap-4">
        <div className="text-3xl shrink-0" aria-hidden="true">🏆</div>
        <div className="flex-1">
          <h2 className="text-lg font-medium text-ink-50 mb-1">
            Become a Founding Creator
          </h2>
          <p className="text-sm text-ink-200 leading-relaxed mb-4">
            Capture <em>your own</em> workflow once and share it to unlock:
            <strong> unlimited captures right now</strong> (no 5/month Free cap), the Founding Creator badge on every skill you share, and your first Pro seat free forever when Pro launches.
            One demonstration → one shared skill → done.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            <Step done={hasCaptured} label="Capture a new skill" hint="/implexa:record-skill in Claude Code" />
            <Step done={hasShared}   label="Share it (any mode)" hint="/implexa:share-this — team or public" />
          </div>

          <Link href="/install" className="text-xs text-brand-600 hover:underline font-medium">
            Don&apos;t have Implexa installed yet? Set it up in 30 seconds →
          </Link>
        </div>
      </div>
    </section>
  );
}

function Step({ done, label, hint }: { done: boolean; label: string; hint: string }) {
  return (
    <div className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${
      done
        ? 'bg-success-400/10 border border-success-400/30'
        : 'bg-ink-900/40 border border-ink-700'
    }`}>
      <span className={`text-base leading-none mt-0.5 ${done ? 'text-success-700 dark:text-success-400' : 'text-ink-500'}`}>
        {done ? '✓' : '○'}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`font-medium ${done ? 'text-ink-100 line-through opacity-70' : 'text-ink-100'}`}>
          {label}
        </div>
        <div className="text-[11px] text-ink-400 font-mono mt-0.5">{hint}</div>
      </div>
    </div>
  );
}
