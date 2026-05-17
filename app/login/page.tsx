'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/logo';
import PasswordInput from '@/components/password-input';

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
  const next       = searchParams?.get('next')  || '';
  const errFromUrl = searchParams?.get('error') || null;

  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState<null | 'password' | 'magic' | 'google' | 'azure'>(null);
  const [error, setError] = useState<string | null>(errFromUrl);
  const [magicSent, setMagicSent] = useState(false);

  function callbackUrl() {
    const url = new URL(`${window.location.origin}/auth/callback`);
    if (next) url.searchParams.set('next', next);
    return url.toString();
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading('password');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(null);
    if (error) setError(error.message);
    else router.push(callbackUrl().replace(window.location.origin, ''));
  }

  async function handleMagicLink() {
    if (!email) { setError('Enter your email above first, then click magic link.'); return; }
    setError(null); setLoading('magic');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl(), shouldCreateUser: false },
    });
    setLoading(null);
    if (error) setError(error.message);
    else setMagicSent(true);
  }

  async function handleOAuth(provider: 'google' | 'azure') {
    setError(null); setLoading(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl(),
        // Azure only returns the `email` claim when explicitly requested.
        // Without these scopes Supabase rejects the sign-in with
        // "Error getting user email from external provider". Google
        // returns email by default but being explicit is harmless.
        scopes: provider === 'azure' ? 'openid email profile' : undefined,
      },
    });
    if (error) { setError(error.message); setLoading(null); }
  }

  if (magicSent) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm card text-center">
          <h1 className="text-2xl font-semibold mb-2">Check your inbox</h1>
          <p className="text-ink-500 text-sm">We sent a magic link to <strong>{email}</strong>. Click it to sign in — no password needed.</p>
          <button onClick={() => setMagicSent(false)} className="text-xs text-brand-600 hover:underline mt-4">← Back to sign in</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6"><Logo height={18} /></div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2 text-ink-50">Sign in</h1>
        <p className="text-ink-300 text-sm mb-8">Skill recording for any AI session.</p>

        {error && (
          <div className="card !p-3 !border-red-500/40 !bg-red-500/5 mb-4 text-sm text-red-700 dark:text-red-400 leading-relaxed">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-xs text-ink-400 hover:underline">dismiss</button>
          </div>
        )}

        <div className="card space-y-4">
          <button onClick={() => handleOAuth('google')} disabled={!!loading} className="btn-outline w-full">
            {loading === 'google' ? 'Redirecting…' : 'Continue with Google'}
          </button>
          <button onClick={() => handleOAuth('azure')} disabled={!!loading} className="btn-outline w-full">
            {loading === 'azure' ? 'Redirecting…' : 'Continue with Microsoft'}
          </button>

          <div className="relative my-2 text-center text-xs text-ink-400">
            <span className="bg-ink-900 px-2 relative z-10">or with email</span>
            <div className="absolute top-1/2 left-0 right-0 h-px bg-ink-700" />
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-3">
            <input type="email" required placeholder="you@work.com" value={email}
                   onChange={(e) => setEmail(e.target.value)} className="input" />
            <PasswordInput required placeholder="password" value={password}
                   onChange={(e) => setPassword(e.target.value)} className="input" />
            <button type="submit" disabled={!!loading} className="btn-primary w-full">
              {loading === 'password' ? 'Signing in…' : 'Sign in with password'}
            </button>
          </form>

          <div className="flex items-center justify-between text-xs pt-1">
            <button
              type="button"
              onClick={handleMagicLink}
              disabled={!!loading}
              className="text-brand-600 hover:underline disabled:opacity-50"
            >
              {loading === 'magic' ? 'Sending…' : '🔮 Email me a magic link instead'}
            </button>
            <Link href="/forgot-password" className="text-ink-400 hover:text-ink-200 hover:underline">
              Forgot password?
            </Link>
          </div>

          <p className="text-center text-sm text-ink-500 pt-2 border-t border-ink-700">
            {/* CRITICAL: preserve `next` so the device-auth chain (and any
             * other deep link) survives the login → signup pivot. Without
             * this, a user landing at /login?next=/cli-auth?code=... who
             * clicks "Create an account" lands at /signup with no next= and
             * the entire flow goes to /skills instead of completing auth. */}
            New here? <Link
              href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
              className="text-brand-600 hover:underline"
            >Create an account</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
