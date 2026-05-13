'use client';

import { useState } from 'react';
import { callBackend } from '@/lib/api';

export default function CheckoutButton({ jwt, plan }: { jwt: string; plan: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null); setLoading(true);
    try {
      const r = await callBackend('/api/v2/billing/checkout', {
        jwt, method: 'POST',
        body: { plan, returnUrl: `${window.location.origin}/settings/billing` },
      });
      window.location.href = r.url;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={go} disabled={loading} className="btn-primary w-full">
        {loading ? 'Redirecting…' : 'Upgrade'}
      </button>
      {error && <p className="text-xs text-red-600 mt-2 text-center">{error}</p>}
    </>
  );
}
