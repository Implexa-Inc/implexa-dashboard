'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';
import type { RolePack } from '@/lib/role-packs';

export default function RolePickerClient({ jwt, roles }: { jwt: string; roles: RolePack[] }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickRole(role: RolePack) {
    setError(null);
    setSelecting(role.slug);
    try {
      const res = await callBackend('/api/v2/skills/bulk-fork', {
        jwt,
        method: 'POST',
        body: {
          slugs: role.starterPlaybooks,
          scope: 'private',
        },
      });
      // Route through /install BEFORE /skills — a brand-new user has zero
      // plugin/connector wired to Claude, so dropping them on the library
      // first is hostile. /install reads ?welcome= to render the right
      // banner (mentioning the forked starter pack), then they navigate
      // to /skills themselves after completing connect-Claude.
      router.push(`/install?welcome=role-${role.slug}&forked=${res.succeeded || 0}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to set up starter pack';
      setError(message);
      setSelecting(null);
    }
  }

  function skip() {
    // Same routing reason as above — /install first, /skills after connect.
    router.push('/install?welcome=skipped');
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {roles.map((role) => {
          const isSelecting = selecting === role.slug;
          const isDisabled  = !!selecting && !isSelecting;
          return (
            <button
              key={role.slug}
              type="button"
              onClick={() => pickRole(role)}
              disabled={!!selecting}
              className={`card text-left transition-all hover:border-brand-500/40 hover:shadow-glow disabled:opacity-50 disabled:cursor-wait ${
                isSelecting ? '!border-brand-500/60 !shadow-glow' : ''
              } ${isDisabled ? 'opacity-30' : ''}`}
            >
              <div className="text-3xl mb-2" aria-hidden="true">{role.icon}</div>
              <div className="font-medium text-ink-50 mb-1">{role.label}</div>
              <div className="text-xs text-ink-400 mb-3 leading-snug">{role.tagline}</div>
              <div className="text-[11px] text-ink-300 leading-relaxed">
                {role.rationale}
              </div>
              <div className="mt-3 text-[11px] text-brand-500 font-medium">
                {isSelecting ? 'Setting up your library…' : `→ Fork ${role.starterPlaybooks.length} Playbooks`}
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="card !p-3 border-red-500/40 text-sm text-red-500 mb-4">
          {error}
        </div>
      )}

      <div className="text-center">
        <button
          type="button"
          onClick={skip}
          disabled={!!selecting}
          className="text-sm text-ink-400 hover:text-ink-200 underline disabled:opacity-50"
        >
          Skip — I&apos;ll browse the library myself
        </button>
      </div>
    </>
  );
}
