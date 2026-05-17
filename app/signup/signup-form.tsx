'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/logo';
import PasswordInput from '@/components/password-input';

/**
 * Client form for /signup.
 *
 * Receives `initialNext` and `initialInvite` from the server component
 * (page.tsx), which has already gated against the "already logged in" case.
 * So this form is only ever shown to actually-unauthenticated visitors.
 */
export default function SignupForm({
  initialNext,
  initialInvite,
}: {
  initialNext:   string | null;
  initialInvite: string | null;
}) {
  const router = useRouter();

  // Preserve `next` through OAuth + email-confirm. If we have an invite token,
  // route post-auth through /onboarding so it can call accept-invite before
  // the workspace picker.
  const next = initialInvite
    ? `/onboarding?invite=${encodeURIComponent(initialInvite)}`
    : (initialNext || '');

  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function callbackUrl() {
    const url = new URL(`${window.location.origin}/auth/callback`);
    if (next) url.searchParams.set('next', next);
    return url.toString();
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { display_name: name },
        emailRedirectTo: callbackUrl(),
      },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    if (data.session) router.push(callbackUrl().replace(window.location.origin, ''));
    else setSent(true);
  }

  async function handleOAuth(provider: 'google' | 'azure') {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl(),
        // See login/login-form.tsx — Azure needs explicit `email profile`
        // scopes or Supabase rejects with "Error getting user email from
        // external provider." Google returns email by default.
        scopes: provider === 'azure' ? 'openid email profile' : undefined,
      },
    });
    if (error) setError(error.message);
  }

  if (sent) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm card text-center">
          <h1 className="text-2xl font-semibold mb-2">Check your inbox</h1>
          <p className="text-ink-500 text-sm">We sent a confirmation link to <strong>{email}</strong>. Click it to finish setting up your account.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6"><Logo height={18} /></div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2 text-ink-50">Create your account</h1>
        <p className="text-ink-300 text-sm mb-8">Free forever — unlimited skills. No credit card required.</p>

        <div className="card space-y-4">
          <button onClick={() => handleOAuth('google')} className="btn-outline w-full">
            Sign up with Google
          </button>
          <button onClick={() => handleOAuth('azure')} className="btn-outline w-full">
            Sign up with Microsoft
          </button>

          <div className="relative my-2 text-center text-xs text-ink-400">
            <span className="bg-ink-900 px-2 relative z-10">or with email</span>
            <div className="absolute top-1/2 left-0 right-0 h-px bg-ink-700" />
          </div>

          <form onSubmit={handleSignup} className="space-y-3">
            <input type="text" required placeholder="Your name" value={name}
                   onChange={(e) => setName(e.target.value)} className="input" />
            <input type="email" required placeholder="you@work.com" value={email}
                   onChange={(e) => setEmail(e.target.value)} className="input" />
            <PasswordInput required minLength={8} placeholder="password (8+ chars)" value={password}
                   onChange={(e) => setPassword(e.target.value)} className="input" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-ink-500 pt-2">
            {/* Preserve `next` so device-auth + other deep links survive
             * the signup → login pivot. Mirrors the login → signup link. */}
            Already have an account? <Link
              href={initialNext ? `/login?next=${encodeURIComponent(initialNext)}` : '/login'}
              className="text-brand-600 hover:underline"
            >Sign in</Link>
          </p>
        </div>

        <p className="text-xs text-ink-300 text-center mt-6 px-4">
          By signing up you agree to our terms of service and privacy policy. Work email recommended — Implexa offers team-based features (skill sharing, org-shared library) that require a verified business domain.
        </p>
      </div>
    </main>
  );
}
