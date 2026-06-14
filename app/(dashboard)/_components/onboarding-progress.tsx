/**
 * <OnboardingProgress /> — a persistent, resumable "finish your setup" banner at
 * the top of Home. It stays visible (no dismiss) until EVERY step is genuinely
 * done, then renders nothing. Each step's done-state is a real signal computed
 * server-side, so the bar can't claim progress the user hasn't made.
 *
 * Steps (in resume order):
 *   1. Set your experience level   → users.proficiency is set
 *   2. Add your starter agents     → the user has ≥1 agent
 *   3. Connect your Claude or Codex → an active API key exists (a live install)
 *
 * "Resume" jumps to the first incomplete step. Server component (links only).
 */

import Link from 'next/link';

export type OnboardingStep = { label: string; href: string; done: boolean };

export default function OnboardingProgress({ steps }: { steps: OnboardingStep[] }) {
  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  if (done >= total) return null; // fully set up — the banner disappears for good

  const next = steps.find((s) => !s.done);
  const pct = Math.round((done / total) * 100);

  return (
    <section className="mb-6 rounded-lg border border-brand-500/30 bg-gradient-to-r from-brand-500/10 to-transparent p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-50">
            Onboarding unfinished
            <span className="ml-2 text-xs font-normal text-ink-400">{done} of {total} steps completed</span>
          </p>
          <div className="mt-2 h-1.5 w-48 max-w-full rounded-full bg-ink-800 overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {next && (
          <Link
            href={next.href}
            className="rounded-lg bg-brand-500 text-ink-950 px-4 py-2 text-sm font-medium hover:bg-brand-400 whitespace-nowrap transition-colors"
          >
            Resume setup
          </Link>
        )}
      </div>

      <ol className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <li key={s.href} className="flex items-center gap-2 text-sm">
            <span
              className={`flex-none inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] ${
                s.done
                  ? 'bg-success-400/20 text-success-600 dark:text-success-400'
                  : 'border border-ink-600 text-ink-600'
              }`}
              aria-hidden="true"
            >
              {s.done ? '✓' : ''}
            </span>
            {s.done ? (
              <span className="text-ink-400 line-through decoration-ink-700">{s.label}</span>
            ) : (
              <Link href={s.href} className="text-ink-100 hover:text-brand-400 hover:underline">
                {s.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
