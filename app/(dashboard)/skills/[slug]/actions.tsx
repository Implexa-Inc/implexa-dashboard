'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';

type Props = {
  jwt:           string;
  slug:          string;
  id:            string;
  currentStatus: 'draft' | 'active' | 'archived';
  isSystem:      boolean;
};

export default function SkillActions({ jwt, id, currentStatus, isSystem }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'activate' | 'archive' | 'share-team' | 'share-public' | 'fork'>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<{ url: string; mode: string; gate: string } | null>(null);

  async function activate() {
    setBusy('activate'); setError(null);
    try {
      await callBackend(`/api/v2/skills/${id}/activate`, { jwt, method: 'POST' });
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally { setBusy(null); }
  }

  async function archive() {
    if (!confirm('Archive this skill? It will no longer appear in /implexa:org-skills.')) return;
    setBusy('archive'); setError(null);
    try {
      await callBackend(`/api/v2/skills/${id}/archive`, { jwt, method: 'POST' });
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally { setBusy(null); }
  }

  async function share(mode: 'team' | 'public') {
    setBusy(mode === 'team' ? 'share-team' : 'share-public');
    setError(null); setShareUrl(null);
    try {
      const r = await callBackend(`/api/v2/skills/${id}/share`, {
        jwt, method: 'POST', body: { shareMode: mode },
      });
      setShareUrl({ url: r.url, mode: r.shareMode, gate: r.gateDescription });
      navigator.clipboard?.writeText(r.url).catch(() => {});
    } catch (err: any) {
      setError(err.message);
    } finally { setBusy(null); }
  }

  async function fork() {
    setBusy('fork'); setError(null);
    try {
      const r = await callBackend(`/api/v2/skills/${id}/fork`, {
        jwt, method: 'POST', body: { scope: 'private' },
      });
      router.push(`/skills/${r.skill.slug}`);
    } catch (err: any) {
      setError(err.message);
    } finally { setBusy(null); }
  }

  return (
    <div className="flex flex-col gap-2 items-end max-w-md w-full">
      <div className="flex flex-wrap gap-2 justify-end">
        {isSystem ? (
          <button onClick={fork} disabled={!!busy} className="btn-primary whitespace-nowrap">
            {busy === 'fork' ? 'Forking…' : 'Fork to my org'}
          </button>
        ) : (
          <>
            {currentStatus === 'draft' && (
              <button onClick={activate} disabled={!!busy} className="btn-primary whitespace-nowrap">
                {busy === 'activate' ? 'Activating…' : 'Activate'}
              </button>
            )}
            <button onClick={() => share('team')} disabled={!!busy} className="btn-ghost border border-ink-700 whitespace-nowrap">
              {busy === 'share-team' ? 'Creating…' : 'Share with team'}
            </button>
            <button onClick={() => share('public')} disabled={!!busy} className="btn-ghost border border-ink-700 whitespace-nowrap">
              {busy === 'share-public' ? 'Creating…' : 'Share publicly'}
            </button>
            {currentStatus === 'active' && (
              <button onClick={archive} disabled={!!busy} className="text-xs text-ink-500 hover:text-red-600 whitespace-nowrap">
                Archive
              </button>
            )}
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-600 text-right">{error}</p>}

      {shareUrl && (
        <div className="card !p-3 !border-brand-500/40 w-full mt-2 bg-gradient-to-b from-ink-900 to-brand-50/20">
          <div className="text-xs font-medium text-brand-500 mb-1">
            ✓ {shareUrl.mode === 'team' ? 'Team' : 'Public'} share link created (copied to clipboard)
          </div>
          <code className="text-xs break-all block bg-ink-950 text-ink-100 rounded px-2 py-1 border border-brand-500/30">{shareUrl.url}</code>
          <p className="text-xs text-ink-200 mt-2">{shareUrl.gate}</p>
        </div>
      )}
    </div>
  );
}
