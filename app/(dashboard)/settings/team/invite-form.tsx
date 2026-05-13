'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';

export default function InviteForm({ jwt }: { jwt: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    email:     string;
    inviteUrl: string;
    reused:    boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setCreated(null); setCopied(false);
    try {
      const r = await callBackend('/api/v2/team/invite', {
        jwt, method: 'POST', body: { email: email.trim() },
      });
      setCreated({ email: r.email, inviteUrl: r.inviteUrl, reused: r.reused });
      navigator.clipboard?.writeText(r.inviteUrl).catch(() => {});
      setEmail('');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to create invite');
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!created) return;
    navigator.clipboard?.writeText(created.inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <form onSubmit={submit} className="card !p-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <input
          type="email"
          required
          placeholder="teammate@yourdomain.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className="input flex-1"
        />
        <button type="submit" disabled={busy || !email.trim()} className="btn-primary whitespace-nowrap">
          {busy ? 'Creating…' : 'Create invite link'}
        </button>
      </form>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      {created && (
        <div className="card !p-3 !border-success-400/40 mt-3 bg-gradient-to-b from-ink-900 to-success-50/10">
          <div className="text-xs font-medium text-success-700 dark:text-success-400 mb-2">
            ✓ Invite link {created.reused ? 'already exists' : 'created'} for {created.email} {created.reused ? '(reused)' : '(copied to clipboard)'}
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all flex-1 bg-ink-800 text-ink-100 rounded px-2 py-1.5 border border-success-400/20 font-mono">
              {created.inviteUrl}
            </code>
            <button
              onClick={copy}
              className={`text-xs px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors ${
                copied
                  ? 'border-success-400/50 text-success-700 dark:text-success-400 bg-success-400/10'
                  : 'border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-ink-100'
              }`}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-ink-300 mt-2 leading-relaxed">
            Send this link to {created.email}. When they sign up via this URL, they&apos;ll auto-join your org without going through the workspace picker. Link expires in 30 days.
          </p>
        </div>
      )}
    </>
  );
}
