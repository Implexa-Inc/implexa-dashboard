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

        {/* ── FAQ ─────────────────────────────────────────────────────
         * Things that come up in real installs. Keep entries short and
         * action-oriented — link to /settings or external repos as needed.
         * Adding entries: prepend new ones (most recent friction first).
         * ────────────────────────────────────────────────────────── */}
        <section className="mt-16 max-w-3xl mx-auto">
          <h2 className="text-xs uppercase tracking-wider text-ink-400 font-bold mb-3">Frequently asked</h2>
          <div className="space-y-2">

            <details className="card !p-0 group">
              <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-4 py-3 select-none flex items-center gap-2 text-sm text-ink-100">
                <span className="text-ink-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                I uninstalled + reinstalled the plugin but I&apos;m still on the old version. What gives?
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-ink-200 leading-relaxed space-y-3 border-t border-ink-700/60">
                <p>
                  Claude Code keeps a local clone of the Implexa marketplace at <code className="text-xs bg-ink-800 px-1 rounded">~/.claude/plugins/marketplaces/implexa/</code>. It doesn&apos;t auto-pull on reinstall — so you get whatever version that local clone was last synced to.
                </p>
                <p>
                  <strong className="text-ink-100">Quick fix</strong>, in your terminal:
                </p>
                <pre className="bg-ink-950 border border-ink-700 rounded-md p-3 text-xs text-ink-100 font-mono overflow-x-auto">cd ~/.claude/plugins/marketplaces/implexa && git pull origin main</pre>
                <p>
                  Then reinstall the plugin (Customize → Personal plugins → uninstall + reinstall, OR CLI <code className="text-xs bg-ink-800 px-1 rounded">/plugin install implexa@implexa</code>). You&apos;ll get the latest version.
                </p>
                <p className="text-xs text-ink-400">
                  Alternative: <code className="text-xs bg-ink-800 px-1 rounded">rm -rf ~/.claude/plugins/marketplaces/implexa</code> then re-add the marketplace from scratch.
                </p>
                <p className="text-xs text-ink-400">
                  This is a Claude Code plugin-manager quirk — Anthropic should auto-pull on reinstall. We&apos;re tracking the fix.
                </p>
              </div>
            </details>

            <details className="card !p-0 group">
              <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-4 py-3 select-none flex items-center gap-2 text-sm text-ink-100">
                <span className="text-ink-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                Which surface should I pick if I&apos;m new to Claude Code?
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-ink-200 leading-relaxed space-y-2 border-t border-ink-700/60">
                <p><strong className="text-ink-100">Claude Code (Desktop)</strong> if you want a visual install with full capture. Click through the Customize panel, no terminal commands.</p>
                <p><strong className="text-ink-100">Claude Code (CLI)</strong> if you live in a terminal and prefer slash-command installs.</p>
                <p>Both give you identical capability: plugin slash commands like <code className="text-xs bg-ink-800 px-1 rounded">/implexa:record-skill</code>, full hook capture (prompts + tool calls + responses), and the complete 30+ MCP tool surface.</p>
                <p className="text-xs text-ink-400">Cowork and Claude chat are for non-coding workflows. Skills you save in any surface are available across all of them.</p>
              </div>
            </details>

            <details className="card !p-0 group">
              <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-4 py-3 select-none flex items-center gap-2 text-sm text-ink-100">
                <span className="text-ink-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                Do I need to install Implexa on every Claude surface?
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-ink-200 leading-relaxed space-y-2 border-t border-ink-700/60">
                <p>
                  No. Pick whichever surface you actually use day-to-day. Your skill library lives in our cloud — it&apos;s shared across all surfaces you install on, and surfaces you don&apos;t install on simply don&apos;t have local plugin commands.
                </p>
                <p className="text-xs text-ink-400">
                  Tip: Cowork install also auto-registers Implexa as a Connector in Claude chat (Desktop). One install, two surfaces.
                </p>
              </div>
            </details>

            <details className="card !p-0 group">
              <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-4 py-3 select-none flex items-center gap-2 text-sm text-ink-100">
                <span className="text-ink-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                Why doesn&apos;t Cowork get full capture?
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-ink-200 leading-relaxed space-y-2 border-t border-ink-700/60">
                <p>
                  Anthropic&apos;s Cowork sandbox currently doesn&apos;t invoke user-level hooks the way Claude Code does. We&apos;ve reported the issue. Until they ship the fix, Cowork captures MCP tool calls (the bulk of useful data) but not conversation turns.
                </p>
                <p>
                  We&apos;ll detect the moment the fix lands automatically — the install page will flip itself to show hooks installation for Cowork too.
                </p>
                <p className="text-xs text-ink-400">
                  Want full capture today? Use Claude Code (Desktop or CLI).
                </p>
              </div>
            </details>

            <details className="card !p-0 group">
              <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-4 py-3 select-none flex items-center gap-2 text-sm text-ink-100">
                <span className="text-ink-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                Where do I find / regenerate my API key?
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-ink-200 leading-relaxed border-t border-ink-700/60">
                <p>
                  <Link href="/settings/api-keys" className="text-brand-500 hover:underline">Settings → API keys</Link>. You can list, copy, rotate, or revoke from there.
                </p>
              </div>
            </details>

          </div>
        </section>

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
