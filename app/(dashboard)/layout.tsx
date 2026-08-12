/**
 * Dashboard layout — shared sidebar + main content area for every authed page.
 *
 * Renders the sidebar with active-link highlighting (via usePathname inside a
 * client component). Fetches user + org context once at the layout level so
 * every child page can assume auth/profile is valid (or it redirects).
 *
 * Subtree includes:
 *   /skills, /skills/[slug]
 *   /integrations
 *   /pricing
 *   /install
 *   /roi
 *   /settings, /settings/billing, /settings/api-keys
 *
 * NOT included (each has its own minimal layout):
 *   /login, /signup, /onboarding/*, /s/[token]/*, /auth/*, /
 */

import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { computeSetupStatus } from '@/lib/setup-status';
import Sidebar, { MobileTopBar } from './_components/sidebar';
import UpdateBanner, { type BehindSurface } from './_components/update-banner';
import AutoUpdateToast from './_components/auto-update-toast';
import PersistIntent from './_components/persist-intent';
import CreateFab from './_components/create-fab';
import SkipLink from './_components/skip-link';
import { getLatestVersions } from '@/lib/versions';
import { MAIN_CONTENT_ID } from '@/lib/navigation';

// Per-surface update command. Claude/Cursor update in-session via /plugin; Codex
// is most reliably refreshed by re-running its installer (git reset --hard).
const SURFACE_META: Record<string, { label: string; command: string }> = {
  claude: { label: 'Claude', command: '/plugin marketplace update implexa && /plugin update implexa@implexa' },
  cursor: { label: 'Cursor', command: '/plugin marketplace update implexa && /plugin update implexa@implexa' },
  codex:  { label: 'Codex',  command: 'curl -fsSL https://core.implexa.ai/install-for-codex.sh | bash' },
};

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Compare each reported surface version to ITS latest; return the behind ones.
// Each surface has its own latest (claude/cursor track the claude repo, codex
// the codex repo), falling back to the global latest when not specified.
function computeBehind(
  pluginVersions: Record<string, string> | null | undefined,
  latest: string | null,
  perSurfaceLatest: Record<string, string> | undefined,
): BehindSurface[] {
  if (!pluginVersions || !latest) return [];
  const out: BehindSurface[] = [];
  for (const [surface, installed] of Object.entries(pluginVersions)) {
    const meta = SURFACE_META[surface];
    if (!meta || typeof installed !== 'string') continue;
    const surfaceLatest = perSurfaceLatest?.[surface] ?? latest;
    if (cmpVersion(installed, surfaceLatest) < 0) {
      out.push({ surface, label: meta.label, installed, latest: surfaceLatest, command: meta.command });
    }
  }
  return out;
}

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // Pulling the new activity timestamps in the same query the layout
  // already runs — zero extra round-trips. Drives the setup-status chip
  // in the sidebar (Level 2 of the post-share-install gate work).
  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, display_name, email, founding_creator_unlocked_at, last_mcp_call_at, last_hook_event_at, plugin_versions')
    .eq('id', session.user.id)
    .maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const { data: org } = await supabase
    .from('organizations').select('plan')
    .eq('id', profile.organization_id).maybeSingle();

  // Sidebar badges are "new since you last opened this page", not raw totals:
  //   Results   = new runs since you last opened Results
  //   Needs you = new held-for-review / stalled runs since you last opened it
  // We hand the client sidebar the recent (bounded) timestamps; it compares them
  // to a per-surface "last opened" marker in localStorage and clears the badge
  // the instant you open that page. (The old badges counted ALL pending-review
  // runs, so both showed the same number and never cleared on a visit.)
  const badgeSince = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const [{ data: resultRows }, { data: needsRows }] = await Promise.all([
    supabase
      .from('skill_runs')
      .select('ran_at')
      .gte('ran_at', badgeSince)
      .order('ran_at', { ascending: false })
      .limit(100),
    supabase
      .from('skill_runs')
      .select('ran_at')
      .or('review_status.eq.pending,run_state.eq.stalled')
      .gte('ran_at', badgeSince)
      .order('ran_at', { ascending: false })
      .limit(100),
  ]);
  const resultRunsAt = ((resultRows as { ran_at: string }[]) || []).map((r) => r.ran_at).filter(Boolean);
  const needsItemsAt = ((needsRows as { ran_at: string }[]) || []).map((r) => r.ran_at).filter(Boolean);

  const setup = computeSetupStatus(profile.last_mcp_call_at, profile.last_hook_event_at);

  // ── App-first hard gate ───────────────────────────────────────────────────
  // The product does nothing without a connected executor (the desktop app, or
  // Claude/Codex via the curl install). A user who has NEVER connected anything
  // (status 'never' = both activity timestamps null) gets routed to /get-app —
  // the dashboard is not a place to look around, it's the control surface for an
  // already-running setup. Peeking/results live on the marketing site. We keep a
  // few routes reachable so they can actually finish connecting (get the app, see
  // other install options, grab an API key, manage the account).
  const ALLOW_WHEN_DISCONNECTED = ['/install', '/settings', '/get-app'];
  if (setup.status === 'never') {
    // 'never' means no MCP/hook activity yet — but the desktop app's drainer
    // polls the backend with the API key every ~20s while it's OPEN, bumping
    // api_keys.last_used_at. Treat that as connected too, so simply opening the
    // app unlocks the dashboard within seconds (no first-run required). Only the
    // not-yet-connected pay this extra query; connected users skip the branch.
    const { data: keyUse } = await supabase
      .from('api_keys')
      .select('last_used_at')
      .eq('user_id', profile.id)
      .eq('status', 'active')
      .not('last_used_at', 'is', null)
      .limit(1);
    const appOpen = (keyUse || []).length > 0;
    if (!appOpen) {
      const { headers } = await import('next/headers');
      const pathname = headers().get('x-pathname') || '';
      const allowed = ALLOW_WHEN_DISCONNECTED.some((p) => pathname.startsWith(p));
      if (!allowed) redirect('/get-app');
    }
  }

  // Out-of-date surfaces drive the top update banner. Best-effort: if the
  // versions feed is unreachable, behind=[] and the banner simply doesn't show.
  const latestVersions = await getLatestVersions();
  const behind = computeBehind(
    profile.plugin_versions as Record<string, string> | null,
    latestVersions?.plugin?.latest ?? null,
    latestVersions?.plugin?.surfaces,
  );

  // Admin check — drives the conditional Admin nav link in the sidebar.
  // NEXT_PUBLIC_ ENV exposes the allowlist to the client (the value is non-
  // sensitive — it's just emails). The actual admin endpoints are gated on
  // the backend independently against ADMIN_EMAILS (no NEXT_PUBLIC prefix).
  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = adminEmails.includes((profile.email || '').toLowerCase());

  const userCtx = {
    // Scopes the shell's per-device "last opened Work" marker so two accounts
    // on one machine cannot inherit each other's badge state.
    id:                profile.id,
    displayName:       profile.display_name,
    email:             profile.email,
    plan:              org?.plan || 'free',
    isFoundingCreator: !!profile.founding_creator_unlocked_at,
    setupStatus:       setup.status,
    lastSeenAt:        setup.lastSeenAt,
    isAdmin,
  };

  return (
    <div className="flex min-h-screen">
      {/* First focusable element on every authed page — see skip-link.tsx. */}
      <SkipLink />
      {/* Persist a website build intent server-side on ANY authed page (incl.
          /install where onboarding lands), so it can never be lost. */}
      <Suspense fallback={null}><PersistIntent /></Suspense>
      <Sidebar user={userCtx} resultRunsAt={resultRunsAt} needsItemsAt={needsItemsAt} />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopBar user={userCtx} resultRunsAt={resultRunsAt} needsItemsAt={needsItemsAt} />
        <UpdateBanner surfaces={behind} installed={profile.plugin_versions as Record<string, string> | null} />
        {/* tabIndex={-1} so the skip link can actually move focus here; without
            it the browser scrolls but focus stays on the link. */}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
      </div>
      {/* Omnipresent "create an agent from anywhere" floating button + build box. */}
      <CreateFab />
      {/* Desktop-app auto-update toast (bottom-left, "Restart to update"). Renders
          nothing on plain web — the capability lives on window.implexaDesktop. */}
      <AutoUpdateToast />
    </div>
  );
}
