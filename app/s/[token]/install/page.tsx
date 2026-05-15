/**
 * /s/[token]/install — bounce-back target for users who signed up FROM a
 * share-preview page. Auto-fires the install endpoint and routes the user
 * onward based on their setup status:
 *
 *   - never set up Implexa in Claude → /install?welcome=1&from_skill=<slug>
 *     They get a welcome banner explaining that the skill is now in their
 *     library and they need one more step to actually use it in Claude.
 *   - already has setup signal       → /skills?installed=<token>
 *     Existing happy-path. The /skills page picks up the ?installed flash
 *     and shows a success toast with the trigger-phrase hint.
 *
 * CRITICAL — do NOT wrap `redirect()` calls in a try/catch. Next.js
 * implements redirects by THROWING a `NEXT_REDIRECT` error that bubbles
 * up to the framework. If you catch it, you'll see `install_error=
 * NEXT_REDIRECT` in the URL because the catch block re-redirects with
 * the swallowed error's message. We keep the try/catch around the
 * backend POST only, and pick the redirect target as a local variable
 * that's used after the try/catch.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';

export const dynamic = 'force-dynamic';

type SetupStatus = 'active' | 'idle' | 'stale' | 'never';

interface InstallResponse {
  installed?: boolean;
  skill?: { slug?: string; name?: string; triggerPhrases?: string[] };
  setup?:   { status?: SetupStatus; lastSeenAt?: string | null; hasHooks?: boolean };
}

export default async function InstallBounceback({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect(`/login?next=/s/${encodeURIComponent(params.token)}/install`);

  // Ensure the user has completed onboarding (has a users row with organization_id)
  const { data: profile } = await supabase
    .from('users').select('organization_id').eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) {
    redirect(`/onboarding?next=/s/${encodeURIComponent(params.token)}/install`);
  }

  // Resolve the install destination INSIDE the try, capture the target in a
  // local variable. Then redirect OUTSIDE the try/catch so the NEXT_REDIRECT
  // throw can propagate cleanly to the Next.js framework.
  let target: string;
  try {
    const resp = await callBackend(`/api/v2/share/${encodeURIComponent(params.token)}/install`, {
      jwt:    session.access_token,
      method: 'POST',
    }) as InstallResponse;

    const setupStatus = resp?.setup?.status || 'never';
    const skillSlug   = resp?.skill?.slug || '';

    if (setupStatus === 'never') {
      // Level 1 gate: this user has never wired up Implexa in their Claude.
      // The skill is in their library, but it's useless until they install
      // the plugin / connector. Drop them on /install with a welcome banner
      // anchored to the skill they just acquired.
      const qs = new URLSearchParams({
        welcome:    '1',
        from_skill: skillSlug,
        token:      params.token,
      });
      target = `/install?${qs.toString()}`;
    } else {
      // Setup-complete (active / idle / stale): standard happy path. The
      // /skills page reads ?installed=<token> and surfaces the "try this
      // in Claude" CTA with the skill's first trigger phrase.
      target = `/skills?installed=${encodeURIComponent(params.token)}`;
    }
  } catch (err: unknown) {
    // Real install error (Forbidden / expired / 500). Bounce back to the
    // preview page with the error message. We're outside the redirect call
    // chain so this catch only sees genuine network/HTTP errors — never a
    // NEXT_REDIRECT (those would propagate from `redirect()` below this).
    const message = err instanceof Error ? err.message : 'Install failed';
    const safe = encodeURIComponent(message);
    target = `/s/${encodeURIComponent(params.token)}?install_error=${safe}`;
  }

  // Outside the try/catch so NEXT_REDIRECT propagates correctly to Next.js.
  redirect(target);
}
