/**
 * <AgentRequirements /> , "What you'll need" before running an agent.
 *
 * Surfaces the agent's prerequisites up front so a user knows what's on their
 * side BEFORE they run it (founder: "before a user runs it they know what's
 * required"). Free CLI tools are shown as auto-installed; paid services are
 * shown with their cost, a sign-up link, and any cheaper alternative.
 *
 * Server component , pure render over detectRequirements(workflow.steps).
 */

import type { Requirements } from '@/lib/requirements';

export default function AgentRequirements({ req }: { req: Requirements }) {
  if (req.tools.length === 0 && req.services.length === 0) return null;

  return (
    <div className="card mb-6">
      <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500 mb-3">What you&apos;ll need</h2>

      {req.services.length > 0 && (
        <div className="space-y-2.5">
          {req.services.map((s) => (
            <div key={s.name} className="flex items-start justify-between gap-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink-100">{s.name}</span>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                    {s.cost}
                  </span>
                </div>
                {s.alt && (
                  <p className="text-xs text-ink-500 mt-1">or use <span className="text-ink-300">{s.alt}</span> instead</p>
                )}
              </div>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-none text-xs text-brand-500 hover:underline whitespace-nowrap mt-0.5"
              >
                Get it ↗
              </a>
            </div>
          ))}
        </div>
      )}

      {req.tools.length > 0 && (
        <div className={req.services.length > 0 ? 'mt-4' : ''}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" aria-hidden />
            <span className="text-xs text-ink-400">Installed for you automatically. No setup needed.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {req.tools.map((t) => (
              <span
                key={t.name}
                title={t.note}
                className="text-xs px-2.5 py-1 rounded-full border border-ink-700 text-ink-300"
              >
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
