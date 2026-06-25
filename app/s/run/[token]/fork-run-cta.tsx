'use client';

/**
 * <ForkRunCta /> — the public Run Card's "run this agent" CTA, made session-aware.
 *
 * The card is public (logged-out viewers see it from a share). Two paths:
 *   - LOGGED IN  → straight to the agent's page (/workflows/<slug>), where the
 *     existing Activate → Run flow adopts it correctly (creates the scheduled_skills
 *     row through activateAgent, then runs via the always-on drainer). We never
 *     hand-roll a fork insert — the proven activation path owns that.
 *   - LOGGED OUT → /signup carrying the agent, so post-auth they land on that same
 *     agent page (signup routes intent=adopt&agent=<slug> → next=/workflows/<slug>).
 *
 * While the session check is in flight we default to the signup path (the safe
 * assumption for a cold share viewer); it flips to the in-app path once resolved.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ForkRunCta({ skillSlug }: { skillSlug: string }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data }) => setAuthed(!!data.session))
      .catch(() => setAuthed(false));
  }, []);

  const href = authed
    ? `/workflows/${encodeURIComponent(skillSlug)}`
    : `/signup?intent=adopt&agent=${encodeURIComponent(skillSlug)}`;
  const label = authed ? 'Run this agent on your Claude' : 'Run this agent in your subscription';

  return (
    <Link href={href} className="btn-success inline-block mt-3 px-5 py-2 text-sm">
      {label} →
    </Link>
  );
}
