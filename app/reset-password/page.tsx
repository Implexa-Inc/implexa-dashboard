'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

/**
 * /reset-password — the user lands here AFTER clicking the email's reset link.
 * The auth/callback already exchanged the token_hash (type=recovery) and set
 * a session, so we just need to call updateUser({ password }) here.
 *
 * If the user lands here WITHOUT a session (link expired, opened in different
 * browser despite our cross-browser support, etc.), we redirect them back to
 * /forgot-password with a clear error.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // On mount: verify a recovery session exists. If not, send back to
  // /forgot-password with a clear message.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!cancelled) setHasSession(!!session);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setDone(true);
      setTimeout(() => router.push('/skills'), 1500);
    }
  }

  if (hasSession === false) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm card text-center">
          <div className="text-3xl mb-3">⚠️</div>
          <h1 className="text-2xl font-semibold mb-2">Link expired or invalid</h1>
          <p className="text-ink-500 text-sm mb-4">
            The reset link is no longer active. Request a fresh one.
          </p>
          <Link href="/forgot-password" className="btn-primary inline-block">
            Get a new reset link
          </Link>
        </div>
      </main>
    );
  }

  if (hasSession === null) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="text-sm text-ink-400">Loading…</div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm card text-center">
          <div className="text-3xl mb-3">✓</div>
          <h1 className="text-2xl font-semibold mb-2">Password updated</h1>
          <p className="text-ink-500 text-sm">Redirecting you to your skills…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="brand-mark text-sm mb-6"><span className="brand-mark-flame">⚡</span> Implexa</div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2 text-ink-50">Set a new password</h1>
        <p className="text-ink-300 text-sm mb-8">
          Choose something memorable. We&apos;ll sign you in automatically when you save.
        </p>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              required
              minLength={8}
              placeholder="New password (8+ chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              autoFocus
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
