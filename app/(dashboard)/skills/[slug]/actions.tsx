'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';

export type ActiveShare = {
  token:              string;
  shareMode:          'team' | 'public';
  url:                string;
  gateDescription:    string;
  allowedEmailDomain: string | null;
  viewCount:          number;
  installCount:       number;
  createdAt:          string;
};

type Props = {
  jwt:           string;
  slug:          string;
  id:            string;
  currentStatus: 'draft' | 'active' | 'archived';
  isSystem:      boolean;
  activeShares:  ActiveShare[];
};

export default function SkillActions({ jwt, id, currentStatus, isSystem, activeShares }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'activate' | 'archive' | 'fork' | `share-${'team' | 'public'}` | `revoke-${string}`>(null);
  const [error, setError] = useState<string | null>(null);

  // Local-state shares (start from SSR-passed list, mutate on create/revoke)
  const [shares, setShares] = useState<ActiveShare[]>(activeShares);
  const teamShare   = shares.find((s) => s.shareMode === 'team')   || null;
  const publicShare = shares.find((s) => s.shareMode === 'public') || null;

  async function activate() {
    setBusy('activate'); setError(null);
    try {
      await callBackend(`/api/v2/skills/${id}/activate`, { jwt, method: 'POST' });
      router.refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(null); }
  }

  async function archive() {
    if (!confirm('Archive this skill? It will no longer appear in /implexa:org-skills.')) return;
    setBusy('archive'); setError(null);
    try {
      await callBackend(`/api/v2/skills/${id}/archive`, { jwt, method: 'POST' });
      router.refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(null); }
  }

  async function fork() {
    setBusy('fork'); setError(null);
    try {
      const r = await callBackend(`/api/v2/skills/${id}/fork`, {
        jwt, method: 'POST', body: { scope: 'private' },
      });
      router.push(`/skills/${r.skill.slug}`);
    } catch (err: any) { setError(err.message); } finally { setBusy(null); }
  }

  async function createShare(mode: 'team' | 'public') {
    setBusy(`share-${mode}`); setError(null);
    try {
      const r = await callBackend(`/api/v2/skills/${id}/share`, {
        jwt, method: 'POST', body: { shareMode: mode },
      });
      const newShare: ActiveShare = {
        token:              r.token,
        shareMode:          r.shareMode,
        url:                r.url,
        gateDescription:    r.gateDescription,
        allowedEmailDomain: r.allowedEmailDomain || null,
        viewCount:          0,
        installCount:       0,
        createdAt:          r.createdAt || new Date().toISOString(),
      };
      setShares((prev) => [newShare, ...prev.filter((s) => s.shareMode !== mode)]);
      // Auto-copy on creation (existing UX). For idempotent reuse we also copy.
      navigator.clipboard?.writeText(r.url).catch(() => {});
    } catch (err: any) { setError(err.message); } finally { setBusy(null); }
  }

  async function revokeShare(token: string) {
    if (!confirm('Revoke this share link? The URL will stop working immediately.')) return;
    setBusy(`revoke-${token}`); setError(null);
    try {
      await callBackend(`/api/v2/skills/${id}/revoke-share`, {
        jwt, method: 'POST', body: { token },
      });
      setShares((prev) => prev.filter((s) => s.token !== token));
    } catch (err: any) { setError(err.message); } finally { setBusy(null); }
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
            <ShareButton
              label="Share with team"
              busyLabel="Creating…"
              isBusy={busy === 'share-team'}
              disabled={!!busy}
              hasActive={!!teamShare}
              onClick={() => createShare('team')}
            />
            <ShareButton
              label="Share publicly"
              busyLabel="Creating…"
              isBusy={busy === 'share-public'}
              disabled={!!busy}
              hasActive={!!publicShare}
              onClick={() => createShare('public')}
            />
            {currentStatus === 'active' && (
              <button onClick={archive} disabled={!!busy} className="text-xs text-ink-500 hover:text-red-600 whitespace-nowrap">
                Archive
              </button>
            )}
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-600 text-right">{error}</p>}

      {/* Active share cards — one per active mode */}
      {teamShare && (
        <SharePanel
          share={teamShare}
          onCopy={() => navigator.clipboard?.writeText(teamShare.url).catch(() => {})}
          onRevoke={() => revokeShare(teamShare.token)}
          revoking={busy === `revoke-${teamShare.token}`}
        />
      )}
      {publicShare && (
        <SharePanel
          share={publicShare}
          onCopy={() => navigator.clipboard?.writeText(publicShare.url).catch(() => {})}
          onRevoke={() => revokeShare(publicShare.token)}
          revoking={busy === `revoke-${publicShare.token}`}
        />
      )}
    </div>
  );
}

function ShareButton({
  label, busyLabel, isBusy, disabled, hasActive, onClick,
}: {
  label: string; busyLabel: string; isBusy: boolean;
  disabled: boolean; hasActive: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap ${
        hasActive
          ? 'text-xs px-2.5 py-1 border border-success-400/50 text-success-700 dark:text-success-400 rounded-md bg-success-400/10 hover:bg-success-400/20'
          : 'btn-ghost border border-ink-700'
      }`}
    >
      {isBusy ? busyLabel : hasActive ? `✓ ${label.toLowerCase()}` : label}
    </button>
  );
}

function SharePanel({
  share, onCopy, onRevoke, revoking,
}: {
  share: ActiveShare;
  onCopy: () => void;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card !p-3 !border-brand-500/40 w-full mt-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="text-xs font-medium text-brand-500">
          {share.shareMode === 'team' ? '🔒 Team share' : '🌐 Public share'} active
        </div>
        <div className="text-[10px] text-ink-400 tabular-nums">
          {share.viewCount} view{share.viewCount === 1 ? '' : 's'} · {share.installCount} install{share.installCount === 1 ? '' : 's'}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <code className="text-xs break-all flex-1 bg-ink-800 text-ink-100 rounded px-2 py-1.5 border border-brand-500/20 font-mono">
          {share.url}
        </code>
        <button
          onClick={handleCopy}
          className={`text-xs px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors ${
            copied
              ? 'border-success-400/50 text-success-700 dark:text-success-400 bg-success-400/10'
              : 'border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-ink-100'
          }`}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-ink-300 leading-relaxed flex-1">{share.gateDescription}</p>
        <button
          onClick={onRevoke}
          disabled={revoking}
          className="text-[11px] text-ink-500 hover:text-red-600 whitespace-nowrap disabled:opacity-50"
        >
          {revoking ? 'Revoking…' : 'Revoke'}
        </button>
      </div>
    </div>
  );
}
