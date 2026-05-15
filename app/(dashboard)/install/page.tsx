/**
 * /install — connect Claude to Implexa.
 *
 * Three steps surfaced cleanly:
 *   1. Get an API key (auto-flagged if missing)
 *   2. Install the plugin in your preferred Claude surface
 *      (tabbed: Claude Code CLI / Claude Desktop / Cowork)
 *   3. Configure capture hooks (one-time curl one-liner)
 *
 * Whichever surface they pick, every command is copy-to-clipboard ready.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import InstallFlow from './install-flow';
import { Logo } from '@/components/logo';

export const dynamic = 'force-dynamic';

export default async function InstallPage({ searchParams }: { searchParams: { welcome?: string; from_skill?: string; token?: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login?next=/install');

  const { data: profile } = await supabase
    .from('users').select('id, email').eq('id', session.user.id).maybeSingle();
  if (!profile) redirect('/onboarding?next=/install');

  // Find the most-recently-created active API key (surface only the prefix —
  // never expose the full key in HTML).
  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, created_at')
    .eq('user_id', profile.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  const hasKey    = (keys || []).length > 0;
  const keyPrefix = keys?.[0]?.key_prefix || null;

  // Platform-fix detection: has Anthropic shipped the Cowork hooks fix?
  // Backed by the platform_signals table — populated server-side the
  // instant we see a hook event from a Cowork user-agent. When this is
  // truthy, the install-flow component drops the "Cowork doesn't fire
  // hooks" warnings AND surfaces the hooks installer step for Cowork
  // too. RLS allows anon read on platform_signals (it's product state,
  // not PII).
  const { data: coworkHooksSignal } = await supabase
    .from('platform_signals')
    .select('signal, first_seen_at')
    .eq('signal', 'cowork_hooks_active')
    .maybeSingle();
  const coworkHooksLive = !!coworkHooksSignal;

  // Welcome banner for users who landed here from a share-link install
  // gate (Level 1). They just acquired their first skill but haven't set
  // up Implexa in Claude yet — they need to finish this page before the
  // skill is actually usable.
  const fromWelcome     = searchParams?.welcome === '1';
  const fromSkillSlug   = (searchParams?.from_skill || '').slice(0, 80);
  let fromSkillName: string | null = null;
  if (fromWelcome && fromSkillSlug) {
    const { data: skill } = await supabase
      .from('org_skills').select('name').eq('slug', fromSkillSlug).maybeSingle();
    fromSkillName = skill?.name || null;
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-4xl mx-auto">
        {fromWelcome && (
          <div className="mb-8 rounded-lg border border-success-400/40 bg-gradient-to-r from-success-400/10 to-brand-500/5 p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5" aria-hidden="true">🎉</span>
              <div className="flex-1 text-sm">
                <p className="font-semibold text-ink-50 mb-1">
                  {fromSkillName
                    ? <>&ldquo;{fromSkillName}&rdquo; is in your library.</>
                    : <>Your first skill is in your library.</>}
                </p>
                <p className="text-ink-200 leading-relaxed">
                  One more step to actually use it: connect Implexa to Claude below. Takes about 2 minutes. Once done, just say{' '}
                  <em className="text-ink-100">&ldquo;Implexa, run {fromSkillSlug || 'this skill'}&rdquo;</em> inside Claude and you&apos;re off.
                </p>
              </div>
            </div>
          </div>
        )}

        <header className="mb-10 text-center">
          <div className="mb-4 flex justify-center"><Logo height={18} /></div>
          <h1 className="text-4xl font-semibold tracking-tight text-ink-50">Connect Claude</h1>
          <p className="text-ink-300 mt-3 leading-relaxed max-w-xl mx-auto">
            Three steps, ~2 minutes. Same skill library + capture loop across every Claude surface.
          </p>
        </header>

        <InstallFlow hasKey={hasKey} keyPrefix={keyPrefix} coworkHooksLive={coworkHooksLive} />

        <footer className="mt-12 text-center text-xs text-ink-400 max-w-xl mx-auto leading-relaxed">
          <p>
            Whichever surface you pick, Implexa captures every prompt + tool call during a recording via host hooks.
            Want to verify the chain works after install? Visit{' '}
            <Link href="/skills" className="text-brand-500 hover:underline">/skills</Link>
            {' '}and run <code className="bg-ink-800 px-1 rounded">/implexa:record-skill</code> for a quick test.
          </p>
        </footer>
      </div>
    </main>
  );
}

export const metadata = {
  title: 'Connect Claude — Implexa',
};
