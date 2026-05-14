'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/logo';

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordInner />
    </Suspense>
  );
}

function ForgotPasswordInner() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // Supabase redirects to this URL after the user clicks the reset link.
      // The callback uses token_hash flow + lands on /reset-password.
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm card text-center">
          <div className="text-3xl mb-3">📬</div>
          <h1 className="text-2xl font-semibold mb-2">Check your inbox</h1>
          <p className="text-ink-500 text-sm mb-4">
            If <strong>{email}</strong> matches an account, we sent a reset link.
            Click it to set a new password.
          </p>
          <Link href="/login" className="text-xs text-brand-600 hover:underline">← Back to sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6"><Logo height={18} /></div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2 text-ink-50">Reset your password</h1>
        <p className="text-ink-300 text-sm mb-8">
          Enter your email and we&apos;ll send you a link to set a new password.
        </p>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="you@work.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoFocus
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>

          <p className="text-center text-sm text-ink-500 pt-4 mt-4 border-t border-ink-700">
            Remembered it? <Link href="/login" className="text-brand-600 hover:underline">Back to sign in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
