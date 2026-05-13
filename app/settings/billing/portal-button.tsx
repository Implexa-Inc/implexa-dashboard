'use client';

import { useState } from 'react';
import { callBackend } from '@/lib/api';

export default function PortalButton({ jwt }: { jwt: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setLoading(true); setError(null);
    try {
      const r = await callBackend('/api/v2/billing/portal', {
        jwt, method: 'POST',
        body: { returnUrl: `${window.location.origin}/settings/billing` },
      });
      window.location.href = r.url;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={open} disabled={loading} className="btn-primary">
        {loading ? 'Opening…' : 'Manage billing'}
      </button>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </>
  );
}
