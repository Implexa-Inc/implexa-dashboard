'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Shows a success toast when arriving from /s/[token]/install — the share-link
 * install bounce-back redirects here with ?installed=<token>.
 */

export default function InstallToast({ installed }: { installed?: string }) {
  const router = useRouter();
  const [visible, setVisible] = useState(!!installed);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      setVisible(false);
      // Clean the query param from the URL
      router.replace('/skills');
    }, 5000);
    return () => clearTimeout(t);
  }, [visible, router]);

  if (!visible) return null;

  return (
    <div className="mb-6 card !bg-brand-50 !border-brand-500/30 flex items-center gap-3">
      <div className="text-xl">✓</div>
      <div className="flex-1 text-sm">
        <span className="font-medium">Skill installed</span> — find it in your library below.
      </div>
      <button onClick={() => setVisible(false)} className="text-xs text-ink-500 hover:text-ink-100">Dismiss</button>
    </div>
  );
}
