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
import { createClient } from '@/lib/supabase/server';
import { computeSetupStatus } from '@/lib/setup-status';
import Sidebar, { MobileTopBar } from './_components/sidebar';

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
    .select('id, organization_id, display_name, email, founding_creator_unlocked_at, last_mcp_call_at, last_hook_event_at')
    .eq('id', session.user.id)
    .maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const { data: org } = await supabase
    .from('organizations').select('plan')
    .eq('id', profile.organization_id).maybeSingle();

  // Pending-review count drives the "Needs you" badge in the sidebar. RLS-scoped
  // to the caller; head:true returns the count with no rows over the wire.
  const { count: pendingCount } = await supabase
    .from('skill_runs')
    .select('id', { count: 'exact', head: true })
    .eq('review_status', 'pending');

  const setup = computeSetupStatus(profile.last_mcp_call_at, profile.last_hook_event_at);

  // Admin check — drives the conditional Admin nav link in the sidebar.
  // NEXT_PUBLIC_ ENV exposes the allowlist to the client (the value is non-
  // sensitive — it's just emails). The actual admin endpoints are gated on
  // the backend independently against ADMIN_EMAILS (no NEXT_PUBLIC prefix).
  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = adminEmails.includes((profile.email || '').toLowerCase());

  const userCtx = {
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
      <Sidebar user={userCtx} pendingCount={pendingCount ?? 0} />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopBar user={userCtx} />
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
