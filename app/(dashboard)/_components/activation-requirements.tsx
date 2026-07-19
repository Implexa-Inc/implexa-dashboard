'use client';

/**
 * <ActivationRequirements /> — "Prepare this agent": the provisioning it needs
 * (paid services + local tools), shown DURING activation and collapsing once
 * satisfied.
 *
 * This is the panel that used to live permanently on Overview. Two problems it
 * had, both fixed here:
 *   1. It never reflected satisfaction — a row said "key ready" while still
 *      showing a cost badge and a "Get it ↗" link, inviting the user to go buy
 *      something they already had.
 *   2. It duplicated the backend's SERVICES table client-side, and the two had
 *      already drifted. Rows now arrive server-computed; there is nothing left to
 *      drift.
 *
 * Satisfied rows collapse into one quiet "Ready: …" line. The user came here to
 * finish setup, so what's DONE should get out of the way of what isn't.
 */

import { InlineAddKeyButton } from './api-key-row';
import type { AgentRequirementsPayload } from '@/lib/activation';

export function ActivationRequirements({ req, slug }: { req: AgentRequirementsPayload | undefined; slug: string }) {
  if (!req) return null;
  const services = req.services ?? [];
  const tools = req.tools ?? [];
  if (!services.length && !tools.length) return null;

  const outstanding = services.filter((s) => !s.satisfied);
  const ready = services.filter((s) => s.satisfied);

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-3">What this agent needs</div>

      {outstanding.length === 0 ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Everything’s set up on this Mac.
        </p>
      ) : (
        <ul className="space-y-3">
          {outstanding.map((s) => (
            <li key={s.key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-ink-100">{s.name}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                    {s.cost}
                  </span>
                </div>
                {/* One key can cover several detected services — say so instead of
                    listing them as separate asks. Seedance rides HeyGen's key, so
                    showing both was asking twice for one thing. */}
                {s.alsoCovers?.length ? (
                  <p className="text-xs text-ink-500 mt-0.5">Also covers {s.alsoCovers.join(', ')}</p>
                ) : s.alt ? (
                  <p className="text-xs text-ink-500 mt-0.5">or use {s.alt} instead</p>
                ) : null}
              </div>
              <div className="flex-none flex items-center gap-1.5">
                {s.provider && <InlineAddKeyButton provider={s.provider} slug={slug} />}
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs px-2.5 py-1">Get it ↗</a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* DONE collapses to one line — never a cost badge or a "Get it" link for
          something already handled. That noise is why this panel got moved. */}
      {ready.length > 0 && outstanding.length > 0 && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-3">
          Ready: {ready.map((s) => s.name).join(', ')}
        </p>
      )}
      {tools.length > 0 && (
        <p className="text-xs text-ink-500 mt-2">
          Installs for you on first run: {tools.map((t) => t.name).join(', ')}
        </p>
      )}
    </div>
  );
}
