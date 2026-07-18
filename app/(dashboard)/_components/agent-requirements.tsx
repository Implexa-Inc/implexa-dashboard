/**
 * <AgentRequirements /> , "What you'll need" before running an agent.
 *
 * Surfaces the agent's prerequisites up front so a user knows what's on their
 * side BEFORE they run it (founder: "before a user runs it they know what's
 * required"). Free CLI tools are shown as auto-installed; paid services are
 * shown with their cost, a sign-up link, and any cheaper alternative.
 *
 * "Add API key" CTA (2026-07-18 founder ask, after editing an agent to add a
 * Runway ML step): a service with a LOCAL_KEY_VAULT provider gets the same
 * "Add API key" affordance already built for the activation card's API-keys
 * step — reused via <InlineAddKeyButton>, not reimplemented (see
 * ./api-key-row.tsx). A service with no vault provider (e.g. OpenAI isn't in
 * the vault's registry yet) keeps just the plain "Get it" link.
 *
 * Server component overall — pure render over detectRequirements(workflow.steps)
 * — but the key-CTA needs client state (the desktop bridge), so it's an inline
 * client sub-component; Next.js lets a server component render one directly.
 */

import type { Requirements } from '@/lib/requirements';
import { InlineAddKeyButton } from './api-key-row';

export default function AgentRequirements({ req, slug }: { req: Requirements; slug: string }) {
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
              <div className="flex-none flex items-center gap-3 mt-0.5">
                {s.provider && <InlineAddKeyButton provider={s.provider} slug={slug} />}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-500 hover:underline whitespace-nowrap"
                >
                  Get it ↗
                </a>
              </div>
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
