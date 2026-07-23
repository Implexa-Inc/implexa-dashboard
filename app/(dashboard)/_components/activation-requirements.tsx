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
import { InlineAddKeyButton, useDesktopBridge } from './api-key-row';
import type { AgentRequirementsPayload } from '@/lib/activation';

type Bridge = { keysGrantedFor?: (slug: string) => Promise<Record<string, boolean>> };
function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop;
  return b && typeof b.keysGrantedFor === 'function' ? b : null;
}

type BrowserSession = NonNullable<AgentRequirementsPayload['services'][number]['browserSession']>;

/**
 * A browser account is a REAL access method, not a checkbox the user can claim.
 * The desktop opens the provider in its dedicated local browser, then probes the
 * authenticated page before the server marks the domain reachable. This same
 * component works for every provider that declares browserSession metadata.
 */
function BrowserSessionAccess({ session, onVerified }: { session: BrowserSession; onVerified: () => void }) {
  const bridge = useDesktopBridge();
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (session.status === 'reachable') {
    return (
      <span className="text-xs text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
        ✓ signed in{session.identity ? ` as ${session.identity}` : ''}
      </span>
    );
  }

  const openSignIn = async () => {
    if (!bridge?.connectAccount) { setNote('Open the Implexa desktop app to sign in and verify this account.'); return; }
    setBusy(true); setNote(null);
    try {
      const out = await bridge.connectAccount(session.domain);
      if (!out?.ok) { setNote(out?.message || 'Could not open the sign-in page.'); return; }
      setOpened(true);
      setNote('Sign in in the Implexa browser, then select Verify.');
    } catch { setNote('Could not open the sign-in page.'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    if (!bridge?.verifyAccount) { setNote('Open the Implexa desktop app to verify this account.'); return; }
    setBusy(true); setNote(null);
    try {
      const out = await bridge.verifyAccount(session.domain);
      if (out?.ok && out.reachable) { onVerified(); return; }
      setNote('Not signed in yet — finish signing in, then verify again.');
    } catch { setNote('Could not verify the account. Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex-none text-right">
      <div className="flex items-center justify-end gap-1.5">
        <button type="button" onClick={openSignIn} disabled={busy} className="btn-outline text-xs px-2.5 py-1">
          {opened ? 'Reopen sign-in' : 'Use signed-in account'}
        </button>
        {opened && <button type="button" onClick={verify} disabled={busy} className="btn-outline text-xs px-2.5 py-1">Verify</button>}
      </div>
      {note && <p className="text-xs text-ink-500 mt-1 max-w-56 leading-snug">{note}</p>}
    </div>
  );
}

export function ActivationRequirements({ req, slug, onChanged }: {
  req: AgentRequirementsPayload | undefined;
  slug: string;
  onChanged?: () => void;
}) {
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

  // An API route needs BOTH halves. Browser-only providers use their separately
  // verified local-session route below, so a provider without a vault key can
  // still be ready without ever inventing an API-key requirement.
  const apiReady = (s: (typeof services)[number]) =>
    !!s.provider && s.keyOnMachine && grants?.[s.provider] === true;
  const browserReady = (s: (typeof services)[number]) => s.browserSession?.status === 'reachable';
  const accessMode = (s: (typeof services)[number]) =>
    s.accessMode ?? (s.apiKeyRequired === false ? 'browser' : s.apiKeyRequired === true ? 'api' : 'unknown');
  // New payloads say which route the workflow actually executes. Old payloads
  // retain the historical API-key behavior for a calm rolling upgrade.
  const satisfied = (s: (typeof services)[number]) => {
    // A verified browser session is an alternative only when the builder has
    // declared the provider browser-only. If a future workflow needs both an
    // API and browser access, do not overstate readiness from either alone.
    const mode = accessMode(s);
    if (mode === 'browser') return browserReady(s);
    if (mode === 'api_and_browser') return apiReady(s) && browserReady(s);
    return apiReady(s);
  };

  const outstanding = services.filter((s) => !satisfied(s));
  const ready = services.filter(satisfied);

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-3">What this agent needs</div>

      {outstanding.length === 0 && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-3">Everything’s set up for this agent.</p>
      )}
      <ul className="space-y-3">
          {services.map((s) => {
            // The key exists but THIS agent isn't allowed it yet — a grant, not a
            // purchase. Never send the user off to buy a second key.
            const needsGrantOnly = !!s.provider && s.keyOnMachine;
            const mode = accessMode(s);
            // A browser-route tool needs a signed-in session, not a key — whether
            // or not the backend registered a verifiable session for it. Veed (no
            // provider, no session widget) still belongs here: it must read
            // "uses your browser", never a cost badge + "Get it" link.
            const browserOnly = mode === 'browser';
            const unknownAccess = mode === 'unknown';
            const keyReady = apiReady(s);
            const isReady = satisfied(s);
            return (
              <li key={s.key} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-ink-100">{s.name}</span>
                    {/* Cost is only news if they still have to go get it. */}
                    {!isReady && !needsGrantOnly && !browserOnly && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                        {s.cost}
                      </span>
                    )}
                  </div>
                  {browserOnly ? (
                    <p className="text-xs text-ink-500 mt-0.5">
                      This workflow uses {s.name} in your local browser — no API key needed.
                    </p>
                  ) : unknownAccess ? (
                    <p className="text-xs text-ink-500 mt-0.5">
                      This workflow names {s.name}, but has not proved whether it uses an API key or a signed-in browser. Use an API key unless this agent is revised to declare browser access.
                    </p>
                  ) : keyReady ? (
                    <p className="text-xs text-ink-500 mt-0.5">Key saved on this Mac and allowed for this agent.</p>
                  ) : needsGrantOnly ? (
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
                  {s.browserSession && <BrowserSessionAccess session={s.browserSession} onVerified={() => onChanged?.()} />}
                  {s.provider && !browserOnly && !keyReady && <InlineAddKeyButton provider={s.provider} slug={slug} />}
                  {keyReady && <span className="text-xs text-emerald-600 dark:text-emerald-400 whitespace-nowrap">✓ key allowed</span>}
                  {/* Suppress "Get it" once a key exists — that was the original
                      complaint: being invited to buy something you already own. */}
                  {!keyReady && !needsGrantOnly && !browserOnly && s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs px-2.5 py-1">Get it ↗</a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

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
