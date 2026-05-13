'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';

type Invite = {
  id:           string;
  invited_email: string;
  status:       'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at:   string;
  created_at:   string;
};

export default function PendingInviteRow({ invite, jwt }: { invite: Invite; jwt: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'revoke' | 'copy' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!confirm(`Revoke invite for ${invite.invited_email}? They won't be able to join via this link.`)) return;
    setBusy('revoke'); setError(null);
    try {
      await callBackend(`/api/v2/team/invites/${invite.id}/revoke`, { jwt, method: 'POST' });
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Revoke failed');
      setBusy(null);
    }
  }

  return (
    <div className="card !p-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink-100 truncate">
          {invite.invited_email}
          <span className="ml-2 text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-accent-400/20 text-accent-700 dark:text-accent-400">
            Pending
          </span>
        </div>
        <div className="text-xs text-ink-400 mt-0.5">
          Sent {new Date(invite.created_at).toLocaleDateString()} · Expires {new Date(invite.expires_at).toLocaleDateString()}
        </div>
      </div>
      <button
        onClick={revoke}
        disabled={busy === 'revoke'}
        className="text-xs text-ink-500 hover:text-red-600 disabled:opacity-50"
      >
        {busy === 'revoke' ? 'Revoking…' : 'Revoke'}
      </button>
      {error && <p className="text-xs text-red-600 w-full">{error}</p>}
    </div>
  );
}
