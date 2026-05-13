'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// Next.js 14: useSearchParams requires a Suspense boundary when the page
// gets statically prerendered. Outer page is a thin wrapper.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams?.get('invite') || '';
  // Preserve `next` through OAuth + email-confirm. If we have an invite token,
  // route post-auth through /onboarding so the page can call accept-invite
  // before the workspace picker.
  const explicitNext = searchParams?.get('next') || '';
  const next = inviteToken
    ? `/onboarding?invite=${encodeURIComponent(inviteToken)}`
    : explicitNext;

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
      options: { redirectTo: callbackUrl() },
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
        <div className="brand-mark text-sm mb-6"><span className="brand-mark-flame">⚡</span> Implexa</div>
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
            <input type="password" required minLength={8} placeholder="password (8+ chars)" value={password}
                   onChange={(e) => setPassword(e.target.value)} className="input" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-ink-500 pt-2">
            Already have an account? <Link href="/login" className="text-brand-600 hover:underline">Sign in</Link>
          </p>
        </div>

        <p className="text-xs text-ink-300 text-center mt-6 px-4">
          By signing up you agree to our terms of service and privacy policy. Work email recommended — Implexa offers team-based features (skill sharing, org-shared library) that require a verified business domain.
        </p>
      </div>
    </main>
  );
}
