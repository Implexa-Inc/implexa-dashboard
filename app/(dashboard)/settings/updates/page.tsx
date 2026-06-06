/**
 * /settings/updates — keep Implexa current.
 *
 * One place to see the latest plugin + desktop versions and update in a click:
 * copy the plugin update command (runs inside Claude Code / Codex), and download
 * the desktop app when a build is published. Versions come from the backend
 * /api/v2/versions feed (single source of truth), so this page reflects new
 * releases without a redeploy.
 *
 * NOTE (precise "you are behind" detection): the dashboard does not yet know the
 * user's INSTALLED plugin version — that needs the plugin to report its version
 * to the backend (a users.plugin_version column). Until then this page shows the
 * latest available version and the update command; it does not claim the user is
 * out of date. That keeps it honest: a one-click way to update, no false alarms.
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

export default async function UpdatesPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const versions = await getLatestVersions();

  // Fallbacks keep the page useful even if the versions feed is unreachable.
  const plugin = versions?.plugin ?? {
    latest: '',
    update_command: '/plugin marketplace update implexa && /plugin update implexa@implexa',
    notes: null,
    changelog_url: null,
  };
  const desktop = versions?.desktop ?? { latest: '', download_url: null, notes: null };

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
            {plugin.latest ? (
              <span className="flex-none text-[11px] font-mono text-ink-200 border border-ink-700 rounded px-2 py-1">
                latest v{plugin.latest}
              </span>
            ) : null}
          </div>

          <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900/40 p-3">
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">Update in Claude</div>
            <div className="flex items-center justify-between gap-3">
              <code className="text-xs text-ink-100 font-mono truncate">{plugin.update_command}</code>
              <CopyText value={plugin.update_command} label="copy update command" />
            </div>
            <p className="text-[11px] text-ink-500 mt-2">
              Paste this in your Claude Code / Codex session, then restart the session so the new tools load.
            </p>
          </div>

          <div className="mt-3 flex items-center gap-4 text-xs">
            <Link href="/install" className="text-brand-500 hover:underline">First time? Connect Claude →</Link>
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
