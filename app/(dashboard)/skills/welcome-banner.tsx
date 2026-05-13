/**
 * Welcome banner — shown on /skills when arriving from onboarding.
 *
 * Reads the `?welcome=` query param and renders a contextual message:
 *   - role-<slug>   → "We forked N Playbooks for you. Pick one to try."
 *   - joined        → "You joined an existing team. Their skills are below."
 *   - skipped       → "Browse the library and capture your first skill."
 *
 * Dismisses on its own once the user navigates anywhere — no persistence
 * needed beyond the query param.
 */

import Link from 'next/link';
import { getRolePack } from '@/lib/role-packs';

type Props = {
  welcome?: string;
  forked?: string;
};

export default function WelcomeBanner({ welcome, forked }: Props) {
  if (!welcome) return null;

  // Role-based welcome
  if (welcome.startsWith('role-')) {
    const slug = welcome.slice(5);
    const role = getRolePack(slug);
    const count = parseInt(forked || '0', 10) || (role?.starterPlaybooks.length ?? 0);

    return (
      <section className="card !bg-gradient-to-r !from-brand-500/10 !to-success-400/10 !border-brand-500/40 mb-8">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0" aria-hidden="true">{role?.icon || '🎉'}</div>
          <div className="flex-1">
            <h2 className="text-lg font-medium text-ink-50 mb-1">
              We forked <strong>{count} Playbook{count === 1 ? '' : 's'}</strong> into your library
            </h2>
            <p className="text-sm text-ink-200 mb-3 leading-relaxed">
              These are your starting point — fork, customize, run them in Claude.
              Then when you&apos;re ready, capture <em>your own</em> workflow once and
              Implexa will save it as a sharable skill.
            </p>
            <div className="flex flex-wrap gap-3 items-baseline">
              <Link href="/install" className="btn-primary !py-1.5 !px-3 text-xs">
                Install in Claude →
              </Link>
              <span className="text-xs text-ink-400">
                Already installed? Pick a skill below and run it.
              </span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Accepted an org invite
  if (welcome === 'invited') {
    return (
      <section className="card !bg-success-400/5 !border-success-400/30 mb-8">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0">👥</div>
          <div className="flex-1">
            <h2 className="text-lg font-medium text-ink-50 mb-1">You joined your team</h2>
            <p className="text-sm text-ink-200 leading-relaxed">
              Welcome! Your team&apos;s saved skills are below. Run any of them in Claude,
              or capture your own workflows to add to the library.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Joined an existing org (Plan A picker)
  if (welcome === 'joined') {
    return (
      <section className="card !bg-success-400/5 !border-success-400/30 mb-8">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0">🤝</div>
          <div className="flex-1">
            <h2 className="text-lg font-medium text-ink-50 mb-1">You joined an existing team</h2>
            <p className="text-sm text-ink-200 leading-relaxed">
              Your team&apos;s saved skills are below. Run any of them in Claude, or capture
              your own workflows to add to the library.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Skipped role pick
  if (welcome === 'skipped') {
    return (
      <section className="card !border-ink-700 mb-8">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0">📚</div>
          <div className="flex-1">
            <h2 className="text-lg font-medium text-ink-50 mb-1">Browse the library</h2>
            <p className="text-sm text-ink-200 leading-relaxed">
              The base Playbooks cover most common workflows. Fork any to customize, or
              capture your own from scratch via <code className="font-mono text-xs bg-ink-800 px-1 rounded">/implexa:record-skill</code> in Claude Code.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return null;
}
