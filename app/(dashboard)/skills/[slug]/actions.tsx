'use client';

import { useState, useEffect, useRef } from 'react';
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
  /** Skill display name — used in confirmation prompts so the user
   * doesn't accidentally nuke the wrong skill. */
  name:          string;
  currentStatus: 'draft' | 'active' | 'archived';
  isSystem:      boolean;
  /** True if the viewing user is the skill's creator — only creators
   * see the Delete button. Org admins can archive but not hard-delete. */
  isOwnedByMe:   boolean;
  /** Usage count — surfaced in the delete-confirm modal so users
   * understand what they're permanently destroying. */
  usageCount:    number;
  activeShares:  ActiveShare[];
};

export default function SkillActions({ jwt, id, name, currentStatus, isSystem, isOwnedByMe, usageCount, activeShares }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'activate' | 'archive' | 'delete' | 'fork' | `share-${'team' | 'public'}` | `revoke-${string}`>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

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

  async function deleteSkill() {
    setBusy('delete'); setError(null);
    try {
      await callBackend(`/api/v2/skills/${id}`, { jwt, method: 'DELETE' });
      // Skill is gone — kick user back to the /skills list. Can't refresh
      // the current page because the skill no longer exists.
      router.push('/skills');
    } catch (err: any) {
      // FK constraint = soft-fail to archive as a fallback. Tell the user
      // explicitly so they understand why hard-delete didn't work.
      if (err.message?.match(/foreign key|fk_constraint|invocations|attribution/i)) {
        setError(`Couldn't permanently delete because of attached data (invocations or attribution). Try archiving instead — it hides the skill but preserves history.`);
      } else {
        setError(err.message);
      }
      setDeleteConfirmOpen(false);
    } finally {
      setBusy(null);
    }
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
    // Different confirm message based on share mode — public revokes
    // ALSO undo the universal-scope promotion, removing the skill from
    // Trending Globally. Surface that side effect explicitly so the user
    // isn't surprised. Team revokes are simpler — just the link stops.
    const share = shares.find((s) => s.token === token);
    const isPublic = share?.shareMode === 'public';
    const confirmMsg = isPublic
      ? 'Undo public share? Three effects:\n' +
        '  1. The share URL stops working immediately\n' +
        '  2. The skill is removed from Trending Globally / the public library\n' +
        '  3. The skill\'s scope reverts to its previous state (org or private)\n' +
        '\n' +
        'Anyone who already forked the skill keeps their copy. Continue?'
      : 'Revoke this share link? The URL will stop working immediately. Teammates who already installed keep their copies.';

    if (!confirm(confirmMsg)) return;
    setBusy(`revoke-${token}`); setError(null);
    try {
      await callBackend(`/api/v2/skills/${id}/revoke-share`, {
        jwt, method: 'POST', body: { token },
      });
      setShares((prev) => prev.filter((s) => s.token !== token));
      // For public revokes, refresh the page so the scope badge + Trending
      // section reflect the revert. Cheap UX win — without it the user
      // sees the "Public" badge persist until manual reload.
      if (isPublic) {
        if (typeof window !== 'undefined') window.location.reload();
      }
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
            {/* More-actions kebab menu — houses Archive + Delete +
              * any future less-common actions. Cleaner than dangling
              * text links to the side of primary buttons, matches the
              * Linear/GitHub/Notion convention for destructive +
              * lesser-used actions. */}
            <MoreActionsMenu
              canArchive={currentStatus !== 'archived'}
              canDelete={isOwnedByMe}
              busy={busy}
              onArchive={archive}
              onDelete={() => setDeleteConfirmOpen(true)}
            />
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-600 text-right">{error}</p>}

      {/* Delete confirmation modal — overlays the whole page. Custom-built
        * because window.confirm() is too easy to dismiss accidentally, and
        * we want to surface the skill name + usage count so the user
        * knows what they're nuking. */}
      {deleteConfirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirmOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <div className="card max-w-md w-full !border-red-500/40">
            <h3 id="delete-confirm-title" className="text-base font-medium text-ink-50 mb-2">
              Permanently delete &ldquo;{name}&rdquo;?
            </h3>
            <p className="text-sm text-ink-200 leading-relaxed mb-2">
              This cannot be undone. The skill, its full version history,
              recordings, and attribution data will be permanently destroyed.
            </p>
            {usageCount > 0 && (
              <p className="text-xs text-accent-400 mb-3">
                ⚠ This skill has been invoked {usageCount} time{usageCount === 1 ? '' : 's'} — deleting will sever those analytics records.
              </p>
            )}
            <p className="text-xs text-ink-300 mb-4">
              <strong>Want to keep the data?</strong> Cancel + click <em>Archive</em> instead — it hides the skill from your library but preserves everything.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={busy === 'delete'}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteSkill}
                disabled={busy === 'delete'}
                className="btn bg-red-600 text-white hover:bg-red-700"
              >
                {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

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

/**
 * Kebab-menu dropdown for less-common skill actions (Archive, Delete,
 * future things like Duplicate, Export, Transfer ownership).
 *
 * Patterns:
 * - Click the ⋯ button → menu opens
 * - Click outside (anywhere else) → menu closes (event listener cleanup)
 * - Click an item → executes the action AND closes the menu
 * - Escape key → closes the menu
 *
 * Why not <details>: <details>/<summary> is simpler but harder to style
 * to match the rest of the app (custom focus ring, animations, etc.).
 * Explicit state machine is worth the few extra lines.
 */
function MoreActionsMenu({
  canArchive,
  canDelete,
  busy,
  onArchive,
  onDelete,
}: {
  canArchive: boolean;
  canDelete:  boolean;
  busy:       null | string;
  onArchive:  () => void;
  onDelete:   () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + escape
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown',   handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown',   handleKey);
    };
  }, [open]);

  // If neither archive nor delete is available, render nothing (e.g.
  // archived system Playbook with no owner).
  if (!canArchive && !canDelete) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!!busy}
        onClick={() => setOpen(!open)}
        className={`btn-ghost border border-ink-700 px-2.5 ${open ? 'bg-ink-800' : ''}`}
      >
        <span aria-hidden="true" className="text-lg leading-none tracking-tighter">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[160px] rounded-lg border border-ink-700 bg-ink-900 shadow-lg shadow-black/40 py-1 z-30"
        >
          {canArchive && (
            <button
              type="button"
              role="menuitem"
              disabled={!!busy}
              onClick={() => { setOpen(false); onArchive(); }}
              className="w-full text-left px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 hover:text-ink-50 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <span aria-hidden="true" className="text-ink-400 w-4 inline-block">📁</span>
              <span>Archive</span>
            </button>
          )}
          {canArchive && canDelete && <div className="my-1 border-t border-ink-800" />}
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              disabled={!!busy}
              onClick={() => { setOpen(false); onDelete(); }}
              className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <span aria-hidden="true" className="w-4 inline-block">🗑</span>
              <span>Delete permanently</span>
            </button>
          )}
        </div>
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
          className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded transition-colors whitespace-nowrap disabled:opacity-50"
          aria-label={share.shareMode === 'public' ? 'Undo public share' : 'Revoke team share'}
        >
          {/* Trash icon — inline SVG, no external dep. 12px to sit balanced with the 11px text. */}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-hidden="true">
            <path d="M2.5 4h11M6.5 4V2.5a1 1 0 011-1h1a1 1 0 011 1V4M4 4l.5 9a1 1 0 001 1h5a1 1 0 001-1L12 4M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {revoking
            ? (share.shareMode === 'public' ? 'Undoing…' : 'Revoking…')
            : (share.shareMode === 'public' ? 'Undo public' : 'Revoke')}
        </button>
      </div>
    </div>
  );
}
