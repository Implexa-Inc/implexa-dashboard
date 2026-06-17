'use client';

import { useEffect, useState } from 'react';
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
  initialIntent,
}: {
  initialNext:   string | null;
  initialInvite: string | null;
  initialIntent?: string | null;
}) {
  const router = useRouter();

  // Stash the build prompt (from the website hero box) in app-origin localStorage
  // immediately, so it survives email-confirm / OAuth redirects. /overview reads
  // it after the account exists and turns it into a build run-request.
  useEffect(() => {
    if (initialIntent && initialIntent.trim()) {
      try { window.localStorage.setItem('implexa_pending_intent', initialIntent.trim()); } catch { /* private mode */ }
    }
  }, [initialIntent]);

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

  async function handleOAuth(provider: 'google' | 'azure' | 'github') {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl(),
        // See login/login-form.tsx — Azure needs explicit `email profile`
        // scopes or Supabase rejects with "Error getting user email from
        // external provider." Google returns email by default. GitHub
        // needs user:email so we can read the primary email when the
        // profile email is private.
        scopes:
          provider === 'azure'  ? 'openid email profile' :
          provider === 'github' ? 'read:user user:email' :
          undefined,
      },
    });
    if (error) {
      setError(provider === 'github'
        ? 'GitHub sign-up failed. Try email instead?'
        : error.message);
    }
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
        <p className="text-ink-300 text-sm mb-8">Free forever, unlimited agents. No credit card required.</p>

        <div className="card space-y-4">
          {/* GitHub goes first — Implexa's audience is developers, so GH is
            * the primary signup path now. Email becomes the fallback. */}
          <button onClick={() => handleOAuth('github')} className="btn-outline w-full flex items-center justify-center gap-2">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-1.95c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 015.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
            </svg>
            Continue with GitHub
          </button>
          <button onClick={() => handleOAuth('google')} className="btn-outline w-full flex items-center justify-center gap-2">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18a11 11 0 000 9.86l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign up with Google
          </button>
          <button onClick={() => handleOAuth('azure')} className="btn-outline w-full flex items-center justify-center gap-2">
            <svg viewBox="0 0 23 23" width="16" height="16" aria-hidden="true">
              <rect x="1"  y="1"  width="10" height="10" fill="#F25022"/>
              <rect x="12" y="1"  width="10" height="10" fill="#7FBA00"/>
              <rect x="1"  y="12" width="10" height="10" fill="#00A4EF"/>
              <rect x="12" y="12" width="10" height="10" fill="#FFB900"/>
            </svg>
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
