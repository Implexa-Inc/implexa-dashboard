'use client';

import { useState, useTransition } from 'react';
import { joinProWaitlist, leaveProWaitlist } from './actions';

export default function ProWaitlistButton({ jwt, alreadyOnWaitlist }: { jwt: string; alreadyOnWaitlist: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [onWaitlist, setOnWaitlist] = useState(alreadyOnWaitlist);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const action = onWaitlist ? leaveProWaitlist : joinProWaitlist;
      const result = await action();
      if (result.ok) setOnWaitlist(!onWaitlist);
      else setError(result.error);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className={`w-full rounded-md py-2 text-sm font-medium border transition-colors disabled:opacity-50 ${
          onWaitlist
            ? 'border-success-400/40 bg-success-400/10 text-success-700 dark:text-success-400 hover:bg-success-400/20'
            : 'border-brand-500 bg-brand-500 text-ink-950 hover:bg-brand-400 hover:shadow-glow'
        }`}
      >
        {isPending
          ? '…'
          : onWaitlist
            ? '✓ On the waitlist — we\'ll email you'
            : 'Join the Pro waitlist'}
      </button>
      {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
      {!onWaitlist && (
        <p className="text-[10px] text-ink-400 mt-1.5 text-center">
          No charge today. We&apos;ll only email when Pro launches.
        </p>
      )}
    </>
  );
}
