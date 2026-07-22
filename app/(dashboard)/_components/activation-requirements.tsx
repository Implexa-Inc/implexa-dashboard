'use client';

/**
 * <ActivationRequirements /> — "What this agent needs": provisioning shown DURING
 * activation, collapsing once genuinely satisfied.
 *
 * This is the panel that used to live permanently on Overview, showing a cost
 * badge and a "Get it ↗" link beside a row already reading "key ready".
 *
 * SATISFIED = KEY ON MACHINE **AND** GRANTED TO THIS AGENT. Both halves, always.
 * The server can only see the first: per-agent grants live in the local vault ACL
 * (~/.implexa/key-grants.json) and never leave the user's Mac. The first cut of
 * this panel treated the server's `keyOnMachine` as satisfaction outright, which
 * recreated the exact dead end PR #63 existed to remove — a brand-new Runway agent
 * read "Everything's set up on this Mac", the row collapsed, and the "Use saved
 * key" action was hidden with no way to authorize it. A row stays ACTIONABLE until
 * the grant actually exists.
 *
 * Unknown is not satisfied: if the bridge is absent (plain web) or the grant read
 * fails, the row stays visible and actionable. Showing an extra row costs a click;
 * hiding the only control strands the user.
 */

import { useEffect, useState } from 'react';
import { InlineAddKeyButton } from './api-key-row';
import type { AgentRequirementsPayload } from '@/lib/activation';

type Bridge = { keysGrantedFor?: (slug: string) => Promise<Record<string, boolean>> };
function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop;
  return b && typeof b.keysGrantedFor === 'function' ? b : null;
}

export function ActivationRequirements({ req, slug }: { req: AgentRequirementsPayload | undefined; slug: string }) {
  // null = not yet known / unreadable. Never treated as granted.
  const [grants, setGrants] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    let alive = true;
    const b = bridge();
    if (!b?.keysGrantedFor) { setGrants(null); return; }
    b.keysGrantedFor(slug)
      .then((m) => { if (alive) setGrants(m || {}); })
      .catch(() => { if (alive) setGrants(null); });
    return () => { alive = false; };
  }, [slug]);

  if (!req) return null;
  const services = req.services ?? [];
  const tools = req.tools ?? [];
  if (!services.length && !tools.length) return null;

  // BOTH halves. A provider with no vault entry (provider === null) can never be
  // granted, so it is never "satisfied" — it only ever offers a Get-it link.
  const satisfied = (s: (typeof services)[number]) =>
    !!s.provider && s.keyOnMachine && grants?.[s.provider] === true;

  const outstanding = services.filter((s) => !satisfied(s));
  const ready = services.filter(satisfied);

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-3">What this agent needs</div>

      {outstanding.length === 0 ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">Everything’s set up for this agent.</p>
      ) : (
        <ul className="space-y-3">
          {outstanding.map((s) => {
            // The key exists but THIS agent isn't allowed it yet — a grant, not a
            // purchase. Never send the user off to buy a second key.
            const needsGrantOnly = !!s.provider && s.keyOnMachine;
            return (
              <li key={s.key} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-ink-100">{s.name}</span>
                    {/* Cost is only news if they still have to go get it. */}
                    {!needsGrantOnly && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                        {s.cost}
                      </span>
                    )}
                  </div>
                  {needsGrantOnly ? (
                    <p className="text-xs text-ink-500 mt-0.5">
                      Key already saved on this Mac. No paste needed — just allow this agent to use it.
                    </p>
                  ) : s.alsoCovers?.length ? (
                    <p className="text-xs text-ink-500 mt-0.5">Also covers {s.alsoCovers.join(', ')}</p>
                  ) : s.alt ? (
                    <p className="text-xs text-ink-500 mt-0.5">or use {s.alt} instead</p>
                  ) : null}
                </div>
                <div className="flex-none flex items-center gap-1.5">
                  {s.provider && <InlineAddKeyButton provider={s.provider} slug={slug} />}
                  {/* Suppress "Get it" once a key exists — that was the original
                      complaint: being invited to buy something you already own. */}
                  {!needsGrantOnly && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs px-2.5 py-1">Get it ↗</a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {ready.length > 0 && outstanding.length > 0 && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-3">Ready: {ready.map((s) => s.name).join(', ')}</p>
      )}
      {tools.length > 0 && (
        <p className="text-xs text-ink-500 mt-2">
          Installs for you on first run: {tools.map((t) => t.name).join(', ')}
        </p>
      )}
    </div>
  );
}
