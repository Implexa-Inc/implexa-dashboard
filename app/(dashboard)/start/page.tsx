/**
 * /start — the state-aware default landing.
 *
 * Home is gone from primary navigation because it owned no unique object
 * (DESIGN.md §4.1). What replaced it is a RULE, not a page — and this route is
 * where every ordinary authenticated entry resolves it: the root redirect, the
 * already-signed-in short circuits on /login and /signup, the auth callback,
 * the post-connect hand-off from /get-app, and the logo.
 *
 *   1. something needs input or a review decision  → Work
 *   2. something is actively running               → Work
 *   3. otherwise                                   → Agents
 *
 * The rule is `resolveDefaultLanding` (pure, lib/navigation) and the snapshot is
 * `loadLandingSnapshot` (lib/landing-load), which composes the authoritative
 * Needs-you, Review-queue and live-feed models. This page owns neither. It must
 * never grow a query: an earlier version derived the answer from two raw
 * skill_runs predicates and was blind to Judge blocks, held runs, ungranted
 * permissions, signed-out connections, missed schedules, and every partial read
 * — see the header of lib/landing.ts.
 *
 * Rule 3 is the only branch that claims nothing needs the user, so it fires only
 * when all three models positively said so. Anything unreadable lands on Work,
 * which is the surface that can explain what it could not see.
 *
 * The dashboard hard gate still applies: this route lives under (dashboard), so
 * a never-connected user is sent to /get-app by the layout before any of this
 * matters.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveDefaultLanding } from '@/lib/navigation';
import { loadLandingSnapshot } from '@/lib/landing-load';

export const dynamic = 'force-dynamic';

export default async function StartPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const snapshot = await loadLandingSnapshot(supabase);

  // Outside any try/catch on purpose: redirect() signals by throwing, and
  // swallowing that would render an empty page instead of navigating.
  redirect(resolveDefaultLanding(snapshot));
}
