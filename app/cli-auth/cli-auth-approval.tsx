'use client';

import { useState } from 'react';
import Link from 'next/link';
import { callBackend } from '@/lib/api';

type SessionInfo = { status: string; expiresAt: string; createdAt: string } | null;

export default function CliAuthApproval({
  verificationCode,
  email,
  sessionInfo,
  accessToken,
}: {
  verificationCode: string;
  email:            string;
  sessionInfo:      SessionInfo;
  accessToken:      string;
}) {
  // UI states:
  //   - idle:     showing the code + Approve/Deny buttons
  //   - approving / denying:  request in flight
  //   - approved: success screen, "return to terminal"
  //   - denied:   neutral confirmation, can close the tab
  //   - error:    show what went wrong + retry / dashboard links
  const [state, setState] = useState<'idle' | 'approving' | 'denying' | 'approved' | 'denied' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pre-load state from session info we fetched server-side. If the session
  // already moved past pending (approved/denied/expired) we go straight to
  // the matching terminal state.
  if (sessionInfo) {
    if (sessionInfo.status === 'approved' && state === 'idle') {
      // (Edge case: user reloaded after approving. Show success.)
      // No setState during render — but we can branch render below.
    }
  }

  // If the session doesn't exist at all on the backend, show a clear error.
  const sessionMissing = sessionInfo === null;

  async function handleApprove() {
    setState('approving');
    setErrorMsg(null);
    try {
      await callBackend('/api/v2/cli-auth/approve', {
        jwt:    accessToken,
        method: 'POST',
        body:   { verificationCode },
      });
      setState('approved');
    } catch (err: any) {
      setErrorMsg(err.message || 'Approval failed');
      setState('error');
    }
  }

  async function handleDeny() {
    setState('denying');
    setErrorMsg(null);
    try {
      await callBackend('/api/v2/cli-auth/deny', {
        jwt:    accessToken,
        method: 'POST',
        body:   { verificationCode },
      });
      setState('denied');
    } catch (err: any) {
      setErrorMsg(err.message || 'Deny failed');
      setState('error');
    }
  }

  // ── State: approved (success) ─────────────────────────────────────
  if (state === 'approved' || (sessionInfo?.status === 'approved' && state === 'idle')) {
    return (
      <div className="card text-center">
        <div className="text-5xl mb-4" aria-hidden>✓</div>
        <h1 className="text-2xl font-semibold text-ink-50 mb-3">You&apos;re signed in.</h1>
        <p className="text-ink-200 leading-relaxed mb-6">
          Return to your terminal — the install will continue automatically. You can close this tab.
        </p>
        <div className="text-xs text-ink-400 border-t border-ink-700 pt-4 leading-relaxed">
          Signed in as <strong className="text-ink-200">{email}</strong>. We minted a fresh API key for this install — view or revoke it any time from{' '}
          <Link href="/settings/api-keys" className="text-brand-500 hover:underline">Settings → API keys</Link>.
        </div>
      </div>
    );
  }

  // ── State: denied ─────────────────────────────────────────────────
  if (state === 'denied' || sessionInfo?.status === 'denied') {
    return (
      <div className="card text-center">
        <div className="text-4xl mb-4" aria-hidden>✗</div>
        <h1 className="text-2xl font-semibold text-ink-50 mb-3">Login request denied.</h1>
        <p className="text-ink-200 leading-relaxed">
          Your terminal will show a denied message. You can close this tab and re-run the install command if you want to try again.
        </p>
      </div>
    );
  }

  // ── State: session not found / expired ────────────────────────────
  if (sessionMissing || sessionInfo?.status === 'expired') {
    return (
      <div className="card text-center">
        <h1 className="text-2xl font-semibold text-ink-50 mb-3">This login request expired.</h1>
        <p className="text-ink-200 leading-relaxed mb-6">
          {sessionInfo?.status === 'expired'
            ? 'The 10-minute timeout passed before you approved. No worries — just run the install command again to start fresh.'
            : 'We couldn\'t find this login session. It may have expired or the verification code might be wrong.'}
        </p>
        <code className="block text-xs bg-ink-900 border border-ink-700 rounded p-3 font-mono text-ink-200 mb-4 overflow-x-auto">
          curl -fsSL https://core.implexa.ai/install.sh | bash
        </code>
        <p className="text-xs text-ink-400">
          Or visit <Link href="/install" className="text-brand-500 hover:underline">/install</Link> for the full guide.
        </p>
      </div>
    );
  }

  // ── State: error ──────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold text-ink-50 mb-3">Couldn&apos;t complete approval.</h1>
        <p className="text-red-600 dark:text-red-400 text-sm mb-4">{errorMsg}</p>
        <p className="text-ink-300 text-sm mb-4 leading-relaxed">
          If you just signed up, you may need to{' '}
          <Link href="/onboarding" className="text-brand-500 hover:underline">finish onboarding</Link>{' '}
          first (create or join an organization). Then come back here and click Approve again.
        </p>
        <button
          type="button"
          onClick={() => { setState('idle'); setErrorMsg(null); }}
          className="btn-outline w-full"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── State: idle (default — show approval UI) ──────────────────────
  return (
    <div className="card">
      <h1 className="text-xl font-semibold text-ink-50 mb-2">Authorize CLI install</h1>
      <p className="text-sm text-ink-300 leading-relaxed mb-5">
        Your terminal is asking permission to log in to Implexa as <strong className="text-ink-100">{email}</strong>.
      </p>

      <div className="rounded-lg border border-ink-700 bg-ink-900 px-4 py-5 mb-4 text-center">
        <p className="text-xs uppercase tracking-wider text-ink-400 mb-2">Verification code</p>
        <p className="text-3xl font-mono font-bold tracking-widest text-brand-500 select-all">
          {verificationCode}
        </p>
        <p className="text-xs text-ink-400 mt-3 leading-relaxed">
          Make sure this matches the code shown in your terminal. If they don&apos;t match, click Deny — something&apos;s wrong.
        </p>
      </div>

      <div className="flex gap-3 mb-4">
        <button
          type="button"
          onClick={handleApprove}
          disabled={state !== 'idle'}
          className="btn-primary flex-1 disabled:opacity-60 disabled:cursor-wait"
        >
          {state === 'approving' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={handleDeny}
          disabled={state !== 'idle'}
          className="btn-outline flex-1 disabled:opacity-60 disabled:cursor-wait"
        >
          {state === 'denying' ? 'Denying…' : 'Deny'}
        </button>
      </div>

      <p className="text-xs text-ink-400 leading-relaxed">
        Approving will mint a fresh API key on your account — visible in{' '}
        <Link href="/settings/api-keys" className="text-brand-500 hover:underline">Settings → API keys</Link>{' '}
        as <em>&ldquo;Install ({new Date().toISOString().slice(0, 10)})&rdquo;</em>. You can revoke it any time.
      </p>
    </div>
  );
}
