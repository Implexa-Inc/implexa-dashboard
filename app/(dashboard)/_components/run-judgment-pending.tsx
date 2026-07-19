'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function RunJudgmentPending({ phase = 'review' }: { phase?: 'review' | 'repair' }) {
  const router = useRouter();
  useEffect(() => {
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      router.refresh();
      if (polls >= 24) clearInterval(timer); // two-minute live window; navigation later re-reads normally
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <div className="mb-6 rounded-xl border border-violet-500/25 bg-violet-500/5 px-4 py-3" role="status">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" aria-hidden />
        <span className="text-sm font-medium text-ink-200">
          {phase === 'repair' ? 'Implexa is repairing this run' : 'Implexa Judge is reviewing this run'}
        </span>
      </div>
      <p className="text-xs text-ink-500 mt-1">
        {phase === 'repair'
          ? 'The agent is applying the Judge’s qualitative feedback hands-off. Its updated result will be reviewed again in a fresh session.'
          : 'A fresh session is checking the request, criteria, memory, and actual artifacts. The verdict will appear here.'}
      </p>
    </div>
  );
}
