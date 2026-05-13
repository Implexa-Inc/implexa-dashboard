/**
 * /install — pick how you connect Claude to Implexa.
 *
 * Three options ranked from easiest to most powerful:
 *   1. Custom Connector — paste a URL into Claude Desktop / Claude.ai. Zero install.
 *   2. Claude Desktop / Cursor stdio — npm package, JSON config.
 *   3. Claude Code plugin — native plugin install, ships all slash commands.
 *
 * Order on this page is "easiest first" because most new users are signing up
 * via a share link and want to be using the skill in 30 seconds, not in 5 minutes.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import InstallOptions from './options';

export const dynamic = 'force-dynamic';

export default async function InstallPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login?next=/install');

  const { data: profile } = await supabase
    .from('users').select('id, email').eq('id', session.user.id).maybeSingle();
  if (!profile) redirect('/onboarding?next=/install');

  // Find the most-recently-created active API key — surfaces a pre-filled key
  // in the install commands so the user doesn't have to find their own.
  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, created_at')
    .eq('user_id', profile.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  const hasKey = (keys || []).length > 0;
  const apiBase = process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai';

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-6xl mx-auto">
        <nav className="text-sm text-ink-300 mb-6">
          <Link href="/skills" className="hover:underline">← Skills</Link>
        </nav>

        <header className="mb-10 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl font-semibold tracking-tight">Connect Claude to Implexa</h1>
          <p className="text-ink-200 mt-3 leading-relaxed">
            Three ways to plug in — pick whichever your client supports. All three give you the same 28 tools and your full skill library.
          </p>
        </header>

        {!hasKey && (
          <div className="card !bg-brand-50 !border-brand-500/30 mb-8 max-w-3xl mx-auto text-center">
            <p className="text-sm">
              <strong>One thing first</strong> — you need an API key for any of these options.
            </p>
            <Link href="/settings/api-keys" className="btn-primary mt-3 inline-block">Generate an API key →</Link>
          </div>
        )}

        <InstallOptions apiBase={apiBase} keyPrefix={keys?.[0]?.key_prefix || null} hasKey={hasKey} />

        {/* Footnote */}
        <footer className="mt-12 text-center text-sm text-ink-500 max-w-2xl mx-auto">
          <p>
            Same 28 tools across every surface. Same skill library. Same outcome attribution.
            Pick whichever you already use, or start with the Custom Connector — it's the fastest path from zero to "watch me do this once."
          </p>
        </footer>
      </div>
    </main>
  );
}
