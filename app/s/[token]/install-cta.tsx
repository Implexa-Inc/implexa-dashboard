'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Props = {
  token:    string;
  isAuthed: boolean;
  gate: {
    shareMode:          'team' | 'public';
    allowedEmailDomain: string | null;
    gateDescription:    string;
  };
};

export default function InstallCta({ token, isAuthed, gate }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<{ slug: string; name: string } | null>(null);

  // Not signed in — send to signup, preserve token in `next` so they land back here.
  if (!isAuthed) {
    return (
      <button
        onClick={() => router.push(`/signup?next=/s/${encodeURIComponent(token)}/install`)}
        className="btn-primary whitespace-nowrap"
      >
        {gate.shareMode === 'team' ? `Sign up with @${gate.allowedEmailDomain}` : 'Sign up to install'}
      </button>
    );
  }

  // Signed in — try to install directly.
  async function handleInstall() {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expired — please sign in again');
      const r = await callBackend(`/api/v2/share/${encodeURIComponent(token)}/install`, {
        jwt:    session.access_token,
        method: 'POST',
      });
      setInstalled({ slug: r.skill.slug, name: r.skill.name });
    } catch (err: any) {
      setError(err.message || 'Install failed');
    } finally {
      setLoading(false);
    }
  }

  if (installed) {
    return (
      <div className="text-right">
        <div className="text-sm font-medium text-brand-600">✓ Installed</div>
        <button
          onClick={() => router.push('/skills')}
          className="mt-2 text-xs text-ink-200 hover:underline"
        >
          View "{installed.name}" in your library →
        </button>
      </div>
    );
  }

  return (
    <div className="text-right">
      <button onClick={handleInstall} disabled={loading} className="btn-primary whitespace-nowrap">
        {loading ? 'Installing…' : 'Install in 1 click'}
      </button>
      {error && <p className="text-xs text-red-600 mt-2 max-w-xs">{error}</p>}
    </div>
  );
}
