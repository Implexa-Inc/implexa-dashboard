'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// Next.js 14: useSearchParams requires a Suspense boundary when the page
// gets statically prerendered. Outer page is a thin wrapper.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams?.get('next') || '';

  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function callbackUrl() {
    const url = new URL(`${window.location.origin}/auth/callback`);
    if (next) url.searchParams.set('next', next);
    return url.toString();
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else router.push(callbackUrl().replace(window.location.origin, ''));
  }

  async function handleOAuth(provider: 'google' | 'azure') {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl() },
    });
    if (error) setError(error.message);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="brand-mark text-sm mb-6"><span className="brand-mark-flame">⚡</span> Implexa</div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2 text-ink-50">Sign in</h1>
        <p className="text-ink-300 text-sm mb-8">Skill recording for any AI session.</p>

        <div className="card space-y-4">
          <button onClick={() => handleOAuth('google')} className="btn-outline w-full">
            Continue with Google
          </button>
          <button onClick={() => handleOAuth('azure')} className="btn-outline w-full">
            Continue with Microsoft
          </button>

          <div className="relative my-2 text-center text-xs text-ink-400">
            <span className="bg-ink-900 px-2 relative z-10">or with email</span>
            <div className="absolute top-1/2 left-0 right-0 h-px bg-ink-700" />
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-3">
            <input type="email" required placeholder="you@work.com" value={email}
                   onChange={(e) => setEmail(e.target.value)} className="input" />
            <input type="password" required placeholder="password" value={password}
                   onChange={(e) => setPassword(e.target.value)} className="input" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm text-ink-500 pt-2">
            New here? <Link href="/signup" className="text-brand-600 hover:underline">Create an account</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
