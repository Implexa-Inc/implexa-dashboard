/**
 * /install — connect Claude to Implexa.
 *
 * Hero-first design (entire.io-style power-user vibe):
 *   - Primary: universal `curl install.sh | bash` command (one paste).
 *     Installs API key, hooks, plugin, MCP wiring — works on macOS/Linux/WSL.
 *   - After-install commands shown inline (`claude`, `/implexa:setup`,
 *     `/implexa:record-skill`).
 *   - Alt surfaces (Cowork, Desktop UI install, Chat connector) live behind
 *     a single collapsed disclosure for users who don't run Claude Code.
 *
 * Logged-in users get a pre-baked install-token curl (zero browser hop —
 * fastest UX). Fallback to the universal `curl install.sh | bash` when
 * token mint fails. Both ultimately produce a working install.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import InstallFlow from './install-flow';
import HeroInstall from './hero-install';
import { Logo } from '@/components/logo';

export const dynamic = 'force-dynamic';

export default async function InstallPage({ searchParams }: { searchParams: { welcome?: string; from_skill?: string; token?: string; forked?: string } }) {
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

  // Mint a fresh install token for the pre-baked curl command. Each visit
  // gets its own 10-min one-time-use token. The script redeems it for a
  // fresh API key — zero manual key handling for the user.
  //
  // Failure mode is non-fatal: if the mint fails (backend down, etc.),
  // we render the install flow without the pre-baked curl, falling back
  // to the manual-key path. The InstallFlow component handles either.
  let installToken: string | null = null;
  let installCurl:  string | null = null;
  try {
    const tokenResp = await callBackend('/api/v2/install-tokens', {
      jwt:    session.access_token,
      method: 'POST',
    });
    if (tokenResp?.token) {
      installToken = tokenResp.token;
      const apiBase = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');
      installCurl = `curl -fsSL "${apiBase}/install.sh?t=${tokenResp.token}" | bash`;
    }
  } catch (_) {
    // Silent fallback — install page still works without the token.
  }

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

  // Welcome banner — context-aware. The ?welcome= query param tells us
  // which onboarding path brought the user here, and we render an
  // appropriately-framed priming message. All paths share the same core
  // ask ("connect Claude to actually use Implexa") but the noun is
  // different ("your first skill" vs "your team's library" vs "your role
  // pack"). Variants:
  //
  //   welcome=1                       → from share-link install (one skill in library)
  //   welcome=joined                  → joined an existing team
  //   welcome=invited                 → accepted an invite link
  //   welcome=role-<slug>&forked=N    → fresh signup + role pack picked
  //   welcome=skipped                 → fresh signup, role pack skipped
  const welcomeRaw = searchParams?.welcome || '';
  const showWelcome = welcomeRaw === '1' || welcomeRaw === 'joined' || welcomeRaw === 'invited' || welcomeRaw === 'skipped' || welcomeRaw.startsWith('role-');
  const fromSkillSlug   = (searchParams?.from_skill || '').slice(0, 80);
  const forkedCount     = Math.max(0, parseInt(searchParams?.forked || '0', 10) || 0);
  let fromSkillName: string | null = null;
  if (welcomeRaw === '1' && fromSkillSlug) {
    const { data: skill } = await supabase
      .from('org_skills').select('name').eq('slug', fromSkillSlug).maybeSingle();
    fromSkillName = skill?.name || null;
  }

  const welcomeBanner = renderWelcomeBanner({ welcomeRaw, fromSkillName, fromSkillSlug, forkedCount });

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        {showWelcome && welcomeBanner}

        <header className="mb-8 text-center">
          <div className="mb-4 flex justify-center"><Logo height={18} /></div>
          <h1 className="text-4xl font-semibold tracking-tight text-ink-50">Connect Claude</h1>
          <p className="text-ink-300 mt-3 leading-relaxed max-w-xl mx-auto">
            One command. Installs the API key, hooks, the Implexa plugin, and MCP wiring — all in ~30 seconds.
          </p>
        </header>

        {/* HERO — the primary install path. Single curl, copy button, after-install commands. */}
        <HeroInstall installCurl={installCurl} />

        {/* ALT SURFACES — power-user fallback. Collapsed by default so the primary flow
         * stays visually clean. Inside: full InstallFlow component with the surface tabs
         * (Code Desktop UI / Cowork / Chat) for users who don't run Claude Code in a
         * terminal. The CLI tab also lives here for users who want the detailed walkthrough.
         */}
        <details className="card !p-0 group mt-2">
          <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-4 py-3 select-none flex items-center gap-2 text-sm text-ink-100">
            <span className="text-ink-400 group-open:rotate-90 transition-transform inline-block">▸</span>
            <span>Don&apos;t use Claude Code? Install for <strong>Cowork</strong>, <strong>Chat</strong>, or via the visual <strong>Desktop UI</strong></span>
          </summary>
          <div className="px-4 pb-4 pt-2 border-t border-ink-700/60">
            <p className="text-xs text-ink-400 mb-4 leading-relaxed">
              Same skill library + capture loop across every Claude surface. Pick whichever you actually use day-to-day.
            </p>
            <InstallFlow
              hasKey={hasKey}
              keyPrefix={keyPrefix}
              coworkHooksLive={coworkHooksLive}
              installCurl={installCurl}
            />
          </div>
        </details>

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

/**
 * Render the context-appropriate welcome banner based on which onboarding
 * path brought the user here. All variants share a common structure
 * (🎉 emoji, headline, body) but the copy is tailored to what just
 * happened (joined a team / accepted invite / picked role pack / etc).
 */
function renderWelcomeBanner({
  welcomeRaw,
  fromSkillName,
  fromSkillSlug,
  forkedCount,
}: {
  welcomeRaw:     string;
  fromSkillName:  string | null;
  fromSkillSlug:  string;
  forkedCount:    number;
}) {
  let headline: React.ReactNode = 'Welcome to Implexa.';
  let body: React.ReactNode = (
    <>One more step to use it: connect Implexa to Claude below.</>
  );

  if (welcomeRaw === '1') {
    // From share-link install — they just acquired their first skill
    headline = fromSkillName
      ? <>&ldquo;{fromSkillName}&rdquo; is in your library.</>
      : <>Your first skill is in your library.</>;
    body = (
      <>
        One more step to actually use it: connect Implexa to Claude below. Takes about 2 minutes. Once done, just say{' '}
        <em className="text-ink-100">&ldquo;Implexa, run {fromSkillSlug || 'this skill'}&rdquo;</em> inside Claude and you&apos;re off.
      </>
    );
  } else if (welcomeRaw === 'joined') {
    headline = <>You joined your team on Implexa.</>;
    body = (
      <>
        Your team&apos;s shared skill library is below — but you can&apos;t run them yet. Connect Implexa to Claude (below) so the saved workflows actually fire in your sessions. Takes about 2 minutes.
      </>
    );
  } else if (welcomeRaw === 'invited') {
    headline = <>You accepted the invite.</>;
    body = (
      <>
        Welcome to the team. One more step before you can run your teammates&apos; saved skills: connect Implexa to Claude below. Takes about 2 minutes.
      </>
    );
  } else if (welcomeRaw.startsWith('role-')) {
    headline = forkedCount > 0
      ? <>{forkedCount} starter Playbook{forkedCount === 1 ? '' : 's'} forked into your library.</>
      : <>Your role pack is ready.</>;
    body = (
      <>
        Connect Implexa to Claude below so those Playbooks actually run when you invoke them. Takes about 2 minutes — same surface every Implexa user goes through.
      </>
    );
  } else if (welcomeRaw === 'skipped') {
    headline = <>Welcome to Implexa.</>;
    body = (
      <>
        One step before you can capture your first skill: connect Implexa to Claude below. Takes about 2 minutes. After that, you can record any workflow with <code className="bg-ink-800 px-1 rounded text-xs">/implexa:record-skill</code>.
      </>
    );
  }

  return (
    <div className="mb-8 rounded-lg border border-success-400/40 bg-gradient-to-r from-success-400/10 to-brand-500/5 p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5" aria-hidden="true">🎉</span>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-ink-50 mb-1">{headline}</p>
          <p className="text-ink-200 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Connect Claude — Implexa',
};
