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
import PrerequisitesChecklist from '../_components/prerequisites-checklist';
import { getProficiency, isGuided } from '@/lib/proficiency';
import { Logo } from '@/components/logo';

export const dynamic = 'force-dynamic';

export default async function InstallPage({ searchParams }: { searchParams: { welcome?: string; from_skill?: string; token?: string; forked?: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login?next=/install');

  const { data: profile } = await supabase
    .from('users').select('id, email').eq('id', session.user.id).maybeSingle();
  if (!profile) redirect('/onboarding?next=/install');

  // Desktop-first: guided (novice/beginner) users get a "what you need" checklist
  // up front. Defensive read (degrades to null if migration 0076 isn't applied).
  const proficiency = await getProficiency(supabase, session.user.id);
  const guided = isGuided(proficiency);

  // Find the most-recently-created active API key (surface only the prefix —
  // never expose the full key in HTML). Last-used timestamp powers the
  // "Connection is active" hero state when the user has an existing install.
  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, created_at, last_used_at')
    .eq('user_id', profile.id)
    .eq('status', 'active')
    .order('last_used_at', { ascending: false, nullsFirst: false })
    .limit(1);

  const hasKey         = (keys || []).length > 0;
  const keyPrefix      = keys?.[0]?.key_prefix || null;
  const lastConnected  = keys?.[0]?.last_used_at || keys?.[0]?.created_at || null;
  const installName    = keys?.[0]?.name || null;

  // Mint a fresh install token for the tokenized curl shown on the hero —
  // this lets logged-in dashboard users skip the browser Approve roundtrip
  // (the script redeems the token directly for an API key). The HeroInstall
  // client component refreshes the token on every Copy click so it never
  // goes stale, even if the tab has been open for hours.
  //
  // Failure mode is non-fatal: when mint fails (backend down, etc.), the
  // hero falls back to the universal `curl install.sh | bash` line — same
  // outcome, just with the browser Approve hop.
  // Same install token works for both Claude Code AND Codex — different
  // script URL, identical token-redemption flow server-side. So we mint
  // once and construct two curls.
  let installCurl: string | null = null;
  let installCurlCodex: string | null = null;
  try {
    const tokenResp = await callBackend('/api/v2/install-tokens', {
      jwt:    session.access_token,
      method: 'POST',
    });
    if (tokenResp?.token) {
      const apiBase = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');
      installCurl      = `curl -fsSL "${apiBase}/install.sh?t=${tokenResp.token}" | bash`;
      installCurlCodex = `curl -fsSL "${apiBase}/install-for-codex.sh?t=${tokenResp.token}" | bash`;
    }
  } catch (_) {
    // Silent fallback to universal curl.
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
  const showWelcome = welcomeRaw === '1' || welcomeRaw === 'joined' || welcomeRaw === 'invited' || welcomeRaw === 'skipped' || welcomeRaw === 'building' || welcomeRaw.startsWith('role-');
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
        {guided && <PrerequisitesChecklist connected={hasKey} />}

        <header className="mb-8 text-center">
          <div className="mb-4 flex justify-center"><Logo height={18} /></div>
          <h1 className="text-4xl font-semibold tracking-tight text-ink-50">Install Implexa</h1>
          <p className="text-ink-300 mt-3 leading-relaxed max-w-xl mx-auto">
            One command per runtime. Installs the API key, hooks, the Implexa plugin, and MCP wiring in ~30 seconds. Claude Code and Codex both supported.
          </p>
        </header>

        {/* HERO — the primary install path. Tokenized curl when available,
         * universal curl as the fallback. Refreshes on copy to never go stale.
         * Shows a "Connection active" banner above the curl when the user
         * already has an install. */}
        <HeroInstall
          initialInstallCurl={installCurl}
          initialInstallCurlCodex={installCurlCodex}
          hasKey={hasKey}
          keyPrefix={keyPrefix}
          installName={installName}
          lastConnected={lastConnected}
        />

        {/* agentskills.io ecosystem badge — signals that skills authored here
         * aren't locked to Claude Code. Drives both trust (this isn't a walled
         * garden) and curiosity (what else does this work in?). */}
        <div className="mt-4 flex justify-center">
          <a
            href="https://agentskills.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs text-ink-400 hover:text-ink-200 transition-colors border border-ink-700 hover:border-ink-500 rounded-full px-3 py-1.5 group"
          >
            <svg className="w-3 h-3 text-success-600 dark:text-success-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
            </svg>
            <span>
              Built on the <strong className="text-ink-200 group-hover:text-ink-50">agentskills.io</strong> open standard ·
              runs in Claude Code, Cursor, Gemini CLI &amp; 30+ more
            </span>
          </a>
        </div>

        {/* ALT SURFACES — power-user fallback. Collapsed by default so the primary flow
         * stays visually clean. Inside: full InstallFlow component with the surface tabs
         * (Code Desktop UI / Cowork / Chat) for users who don't run Claude Code in a
         * terminal. The CLI tab also lives here for users who want the detailed walkthrough.
         */}
        <details className="card !p-0 group mt-2">
          <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-4 py-3 select-none flex items-center gap-2 text-sm text-ink-100">
            <span className="text-ink-400 group-open:rotate-90 transition-transform inline-block">▸</span>
            <span>Other runtimes: <strong>Cursor</strong>, <strong>Gemini CLI</strong>, <strong>Cowork</strong>, <strong>Chat</strong>, or visual <strong>Desktop UI</strong></span>
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
                How do I fully uninstall or reset Implexa on this machine?
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-ink-200 leading-relaxed space-y-3 border-t border-ink-700/60">
                <p>
                  One command. Reverses everything the install script set up: API key file, hooks, MCP wiring, Claude Code plugin, AND the launchctl-set env vars (those survive shell <code className="text-xs bg-ink-800 px-1 rounded">unset</code> and re-leak into new Terminal tabs on macOS — biggest source of &ldquo;why does my fresh install still pick up the old account?&rdquo;).
                </p>
                <pre className="bg-ink-950 border border-ink-700 rounded-md p-3 text-xs text-ink-100 font-mono overflow-x-auto">curl -fsSL https://core.implexa.ai/uninstall.sh | bash</pre>
                <p className="text-xs text-ink-400">
                  Idempotent — safe to re-run anytime. After it finishes, opening a fresh Terminal and running the install command gives you a true fresh-install experience (browser auth runs, no env vars leak through).
                </p>
                <p className="text-xs text-ink-400">
                  <strong className="text-ink-200">What&apos;s NOT removed:</strong> your API keys in the cloud (revoke at <Link href="/settings/api-keys" className="text-brand-500 hover:underline">Connected installs</Link> if you want a fully clean slate), your Implexa account, and your skill library.
                </p>
              </div>
            </details>

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
                Which runtime should I pick?
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-ink-200 leading-relaxed space-y-2 border-t border-ink-700/60">
                <p><strong className="text-ink-100">Claude Code (CLI)</strong> is the most-tested install. Best capture, full plugin support, and what we run end-to-end QA against.</p>
                <p><strong className="text-ink-100">Codex (CLI)</strong> is fully supported as of v0.16. Same skill library, same SkillRank ranking, same <code className="text-xs bg-ink-800 px-1 rounded">/implexa:run</code> wedge. Use the second curl above.</p>
                <p><strong className="text-ink-100">Claude Code (Desktop)</strong> if you prefer a visual install — same capture as the CLI version, just clicked-through.</p>
                <p>All three give you the full 7 slash commands and 30+ MCP tools. Your library is cloud-hosted and shared across whichever runtimes you install on.</p>
                <p className="text-xs text-ink-400">Cursor, Gemini CLI, Cowork, and Claude chat work for read-only browsing but don&apos;t support full capture yet — pick Claude Code or Codex if you want to record skills.</p>
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

        {/* ── Uninstall / reset section ──
          * Quiet placement at the bottom — not competing with the install
          * hero up top. Surfaces the one-line reset command for users who
          * want to clean up their machine (test fresh installs, swap accounts,
          * remove the tool entirely). The detailed explanation lives in the
          * FAQ above; this section is just the command + one-line context.
          */}
        <section className="mt-16 max-w-3xl mx-auto pt-8 border-t border-ink-800">
          <div className="flex items-baseline justify-between gap-4 mb-2">
            <h2 className="text-xs uppercase tracking-wider text-ink-400 font-bold">Uninstall / reset</h2>
            <span className="text-[11px] text-ink-500">macOS · Linux · WSL</span>
          </div>
          <p className="text-xs text-ink-300 leading-relaxed mb-3">
            One command — reverses everything the install set up (API key file, hooks, MCP wiring, plugin, launchctl env). Doesn&apos;t revoke your cloud API keys; that&apos;s a separate action at{' '}
            <Link href="/settings/api-keys" className="text-brand-500 hover:underline">Connected installs</Link>.
          </p>
          <pre className="bg-ink-950 border border-ink-700 rounded-md p-3 text-xs text-ink-100 font-mono overflow-x-auto hide-scrollbar">curl -fsSL https://core.implexa.ai/uninstall.sh | bash</pre>
        </section>

        <footer className="mt-12 text-center text-xs text-ink-400 max-w-xl mx-auto leading-relaxed">
          <p>
            Once connected, try the wedge first: <code className="bg-ink-800 px-1 rounded">/implexa:run draft a cold outreach email</code>{' '}
            searches the cross-vendor skill graph, ranks the matches with SkillRank, and runs the best one inline in your current session.{' '}
            No install per skill, no SKILL.md copying.
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
      ? <>{forkedCount} starter agent{forkedCount === 1 ? '' : 's'} added to your account.</>
      : <>Your starter agents are ready.</>;
    body = (
      <>
        Connect Implexa to your own Claude or Codex below so those agents actually run when you turn them on. Takes about 2 minutes — same surface every Implexa user goes through.
      </>
    );
  } else if (welcomeRaw === 'building') {
    // Intent-carrier: they typed an agent on the website; it's queued to build.
    headline = <>Your agent is queued to build.</>;
    body = (
      <>
        One step left: connect Implexa to your own Claude or Codex below. The moment you connect, the agent you described builds itself and runs there, as you, free on the plan you already pay for. Takes about 2 minutes.
      </>
    );
  } else if (welcomeRaw === 'skipped') {
    headline = <>Welcome to Implexa.</>;
    body = (
      <>
        One step before your agents can run: connect Implexa to your own Claude Code or Codex below. Takes about 2 minutes. After that, try <code className="bg-ink-800 px-1 rounded text-xs">/implexa:run draft a cold outreach email</code> to see one run for yourself.
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
