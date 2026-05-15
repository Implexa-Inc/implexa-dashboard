'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';

type Props = {
  jwt: string;
  email: string;
  displayName: string;
  suggestion: { organizationId: string; organizationName: string; memberCount: number } | null;
  next?: string | null;
};

export default function OnboardingPicker({ jwt, email, displayName, suggestion, next }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<'join' | 'fresh' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function provision(joinOrgId: string | null) {
    setError(null);
    setLoading(joinOrgId ? 'join' : 'fresh');

    // The provision call is idempotent on the backend (joining an org with
    // an already-assigned user is a no-op; provisioning a fresh workspace
    // for someone who already has one returns their existing org). So we
    // can safely auto-retry once on transient errors (network blip, ECS
    // cold-start timeout) without risking double-provisioning state.
    const MAX_ATTEMPTS = 2;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await callBackend('/api/v2/auth/provision', {
          jwt, method: 'POST',
          body: { displayName, joinOrgId },
        });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) {
          // Brief delay before retry — gives the backend / network time to
          // settle. 500ms is small enough that users don't perceive it as
          // a freeze.
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : 'Provisioning failed';
      setError(message);
      setLoading(null);
      return;
    }

    // Success path: route through /install first (a brand-new user has zero
    // plugin/connector wired to Claude, so /skills before /install would
    // show skills they can't run). The /install page reads ?welcome= to
    // render the right banner. Joining an existing org skips role pick —
    // they inherit the team library.
    const destination = next
      ? next
      : joinOrgId
        ? '/install?welcome=joined'
        : '/onboarding/role';
    router.push(destination);
    // Safety net: if router.push silently fails to navigate (network blip,
    // race with auth-cookie refresh, etc.), force a hard navigation after
    // 2s so the user isn't stuck staring at a "Joining…" button forever.
    // The provision call already succeeded — they just need to GET to the
    // destination.
    setTimeout(() => {
      if (typeof window !== 'undefined' && window.location.pathname === '/onboarding') {
        window.location.href = destination;
      }
    }, 2000);
  }

  if (!suggestion) {
    return (
      <div className="card space-y-4">
        <h2 className="text-lg font-medium">Create your workspace</h2>
        <p className="text-sm text-ink-500">
          We'll set up a fresh workspace for <strong>{email}</strong>. You can invite teammates anytime.
        </p>
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400 leading-relaxed">
            <p className="font-medium mb-0.5">Setup didn&apos;t go through</p>
            <p className="text-xs opacity-90">{error}</p>
            <p className="text-xs mt-1.5 opacity-70">Try again — most setup hiccups are transient and clear on retry.</p>
          </div>
        )}
        <button onClick={() => provision(null)} disabled={loading === 'fresh'} className="btn-primary w-full">
          {loading === 'fresh' ? 'Setting up…' : 'Continue to my workspace'}
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-medium">Join your team?</h2>
        <p className="text-sm text-ink-500 mt-1">
          <strong>{suggestion.memberCount} member{suggestion.memberCount === 1 ? '' : 's'}</strong> from your domain
          already use Implexa in the <strong>{suggestion.organizationName}</strong> workspace.
        </p>
      </div>

      <div className="rounded-lg border border-brand-500/20 bg-brand-50 p-4 text-sm">
        <p className="text-ink-200 leading-relaxed">
          Join them to instantly see your team's saved skills and shared Playbooks.
          You can still create a separate workspace if you're working on something independent.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => provision(suggestion.organizationId)} disabled={!!loading} className="btn-primary">
          {loading === 'join' ? 'Joining…' : 'Join their workspace'}
        </button>
        <button onClick={() => provision(null)} disabled={!!loading} className="btn-ghost border border-ink-700">
          {loading === 'fresh' ? 'Setting up…' : 'Create a separate one'}
        </button>
      </div>
    </div>
  );
}
