/**
 * /settings/updates — keep Implexa current.
 *
 * One place to see the latest plugin + desktop versions and update in a click:
 * copy the plugin update command (runs inside Claude Code / Codex), and download
 * the desktop app when a build is published. Versions come from the backend
 * /api/v2/versions feed (single source of truth), so this page reflects new
 * releases without a redeploy.
 *
 * Precise "you are behind" detection: the plugin reports its installed version
 * on every MCP call (X-Implexa-Plugin-Version), stored on users.plugin_version.
 * We compare it to the latest from the versions feed and show one of three
 * states: up to date, update available, or unknown (never reported). When the
 * installed version is unknown we fall back to a neutral "here is how to update"
 * so we never raise a false alarm.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getLatestVersions } from '@/lib/versions';
import CopyText from '../../_components/copy-text';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Updates — Implexa',
};

// Compare dotted versions. Returns -1 if a<b, 0 if equal, 1 if a>b. Tolerant of
// missing/short segments and non-numeric suffixes (compares the numeric prefix).
function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export default async function UpdatesPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('plugin_version, plugin_version_at')
    .eq('id', session.user.id).maybeSingle();
  const installed = (profile?.plugin_version as string | null) || null;

  const versions = await getLatestVersions();

  // Fallbacks keep the page useful even if the versions feed is unreachable.
  const plugin = versions?.plugin ?? {
    latest: '',
    update_command: '/plugin marketplace update implexa && /plugin update implexa@implexa',
    notes: null,
    changelog_url: null,
  };
  const desktop = versions?.desktop ?? { latest: '', download_url: null, notes: null };

  // Installed-vs-latest verdict for the plugin.
  //   'current'  installed === latest      → up to date
  //   'behind'   installed < latest         → update available
  //   'ahead'    installed > latest          → dev/preview build (treat as fine)
  //   'unknown'  never reported / no latest  → neutral how-to-update
  const pluginState: 'current' | 'behind' | 'ahead' | 'unknown' =
    !installed || !plugin.latest
      ? 'unknown'
      : cmpVersion(installed, plugin.latest) < 0
        ? 'behind'
        : cmpVersion(installed, plugin.latest) > 0
          ? 'ahead'
          : 'current';

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <Link href="/settings" className="text-xs text-brand-500 hover:underline">← Settings</Link>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50 mt-2">Updates</h1>
          <p className="text-ink-300 text-sm mt-1">
            Keep your Implexa plugin and desktop app current. Updates ship new workflows, better recommendations, and fixes.
          </p>
        </header>

        {/* Plugin */}
        <section className="card mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="text-2xl shrink-0" aria-hidden="true">⚡</div>
              <div className="min-w-0">
                <div className="font-medium text-ink-50">Implexa plugin</div>
                <div className="text-xs text-ink-300 mt-0.5">
                  Runs inside Claude Code, Desktop, Cursor, and Codex. This is the recommender + workflow engine.
                </div>
                {plugin.notes ? (
                  <div className="text-xs text-ink-400 mt-2 leading-relaxed">{plugin.notes}</div>
                ) : null}
              </div>
            </div>
            <div className="flex-none flex flex-col items-end gap-1">
              {pluginState === 'behind' ? (
                <span className="text-[11px] font-semibold uppercase tracking-wider rounded px-2 py-1 bg-amber-400/15 text-amber-600 dark:text-amber-300 border border-amber-400/30">
                  Update available
                </span>
              ) : pluginState === 'current' ? (
                <span className="text-[11px] font-semibold uppercase tracking-wider rounded px-2 py-1 bg-emerald-400/15 text-emerald-600 dark:text-emerald-300 border border-emerald-400/30">
                  ✓ Up to date
                </span>
              ) : null}
              {plugin.latest ? (
                <span className="text-[11px] font-mono text-ink-400">
                  {installed ? `v${installed} → ` : ''}latest v{plugin.latest}
                </span>
              ) : null}
            </div>
          </div>

          {/* Update box — emphasised when behind/unknown, muted when current. */}
          {pluginState === 'current' ? (
            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-ink-300">
              You are running the latest plugin (v{installed}). Nothing to do — the command below is here if you ever need to reinstall.
              <div className="flex items-center justify-between gap-3 mt-2">
                <code className="text-xs text-ink-100 font-mono truncate">{plugin.update_command}</code>
                <CopyText value={plugin.update_command} label="copy command" />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900/40 p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">
                {pluginState === 'behind' ? `Update to v${plugin.latest} in Claude` : 'Update in Claude'}
              </div>
              <div className="flex items-center justify-between gap-3">
                <code className="text-xs text-ink-100 font-mono truncate">{plugin.update_command}</code>
                <CopyText value={plugin.update_command} label="copy update command" />
              </div>
              <p className="text-[11px] text-ink-500 mt-2">
                Paste this in your Claude Code / Codex session, then restart the session so the new tools load.
                {pluginState === 'unknown' ? ' We have not seen your plugin report a version yet — run a prompt in Claude with Implexa connected and this page will show your installed version.' : ''}
              </p>
            </div>
          )}

          <div className="mt-3 flex items-center gap-4 text-xs">
            <Link href="/settings/engines" className="text-brand-500 hover:underline">Manage AI engines →</Link>
            {plugin.changelog_url ? (
              <a href={plugin.changelog_url} target="_blank" rel="noreferrer" className="text-ink-400 hover:underline">
                What changed →
              </a>
            ) : null}
          </div>
        </section>

        {/* Desktop */}
        <section className="card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="text-2xl shrink-0" aria-hidden="true">🖥️</div>
              <div className="min-w-0">
                <div className="font-medium text-ink-50">Implexa desktop app</div>
                <div className="text-xs text-ink-300 mt-0.5">
                  Optional menu-bar companion: run notifications, onboarding, and your dashboard in one window.
                </div>
                {desktop.notes ? (
                  <div className="text-xs text-ink-400 mt-2 leading-relaxed">{desktop.notes}</div>
                ) : null}
              </div>
            </div>
            {desktop.latest ? (
              <span className="flex-none text-[11px] font-mono text-ink-200 border border-ink-700 rounded px-2 py-1">
                v{desktop.latest}
              </span>
            ) : null}
          </div>

          <div className="mt-4">
            {desktop.download_url ? (
              <a
                href={desktop.download_url}
                className="inline-flex items-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-4 py-2 text-sm font-medium text-brand-500 hover:bg-brand-500/15 transition-colors"
              >
                Download for macOS →
              </a>
            ) : (
              <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-3 text-xs text-ink-400">
                The desktop app is not yet published for download. The plugin above is all you need to run workflows —
                the desktop app only adds presence (notifications + a window), never anything the plugin cannot do.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
