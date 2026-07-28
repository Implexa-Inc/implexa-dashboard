'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Retry for the "couldn't load agent status" state.
 *
 * A <Link href="/workflows"> from the workflows page is a no-op navigation: Next sees
 * the same route and may serve it from the client cache without re-running the server
 * component, so the failed fetch is never retried. router.refresh() re-runs it
 * explicitly (review, 2026-07-28).
 *
 * Pending state is shown because the underlying call is the SLOW one -- /me/agents
 * measured 2.5-4.5s for 50 agents -- so a button that looked inert would invite
 * repeated clicking.
 */
export default function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setTried(true);
        startTransition(() => router.refresh());
      }}
      className="mt-2 inline-block underline hover:no-underline disabled:opacity-60"
    >
      {pending ? 'Retrying…' : tried ? 'Retry again' : 'Retry'}
    </button>
  );
}
