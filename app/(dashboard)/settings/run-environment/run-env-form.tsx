'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export default function RunEnvForm({
  currentWorkspaceRoot,
  currentChromeProfile,
}: {
  currentWorkspaceRoot: string;
  currentChromeProfile: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [workspaceRoot, setWorkspaceRoot] = useState(currentWorkspaceRoot);
  const [chromeProfile, setChromeProfile] = useState(currentChromeProfile);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    workspaceRoot.trim() !== currentWorkspaceRoot.trim() ||
    chromeProfile.trim() !== currentChromeProfile.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true); setDone(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Session lost — sign in again.'); setSaving(false); return; }
      await callBackend('/api/v2/me/run-env', {
        method: 'POST',
        jwt: session.access_token,
        body: { workspaceRoot: workspaceRoot.trim(), chromeProfile: chromeProfile.trim() },
      });
      setDone(true);
      setTimeout(() => setDone(false), 2000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="card">
        <h2 className="text-base font-medium text-ink-50 mb-1">Workspace folder</h2>
        <p className="text-xs text-ink-300 mb-4 leading-relaxed">
          Absolute path on this machine that agents needing local files should run in. An agent that
          reads your docs or builds something runs here, so it has the right files on hand.
        </p>
        <input
          type="text"
          placeholder="/Users/you/your-workspace"
          value={workspaceRoot}
          onChange={(e) => setWorkspaceRoot(e.target.value)}
          disabled={saving}
          className="input w-full font-mono text-sm"
          spellCheck={false}
          autoCapitalize="off"
        />
      </section>

      <section className="card">
        <h2 className="text-base font-medium text-ink-50 mb-1">Browser profile</h2>
        <p className="text-xs text-ink-300 mb-4 leading-relaxed">
          Which connected browser / Chrome profile holds your logged-in accounts, for agents that need
          to act in a site you&apos;re signed into (e.g. a dashboard). Use the name as it appears in your
          connected browsers.
        </p>
        <input
          type="text"
          placeholder="e.g. Implexa Claude Chrome Connect"
          value={chromeProfile}
          onChange={(e) => setChromeProfile(e.target.value)}
          disabled={saving}
          className="input w-full"
        />
      </section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving || !dirty} className="btn-primary whitespace-nowrap">
          {saving ? 'Saving…' : done ? '✓ Saved' : 'Save run environment'}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </form>
  );
}
