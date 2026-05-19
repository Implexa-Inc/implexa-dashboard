'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { SetupStatus } from '@/lib/setup-status';

type Props = {
  token:    string;
  isAuthed: boolean;
  gate: {
    shareMode:          'team' | 'public';
    allowedEmailDomain: string | null;
    gateDescription:    string;
  };
};

// Shape of the /api/v2/share/:token/install response (mirrors backend).
type InstallResponse = {
  installed: boolean;
  skill: {
    slug: string;
    name: string;
    triggerPhrases?: string[];
  };
  setup?: { status: SetupStatus; lastSeenAt: string | null; hasHooks: boolean };
};

export default function InstallCta({ token, isAuthed, gate }: Props) {
  const router   = useRouter();
  const supabase = createClient();
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [installed, setInstalled] = useState<{
    slug: string;
    name: string;
    triggerPhrase: string | null;
    setupStatus:   SetupStatus;
  } | null>(null);

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
      }) as InstallResponse;

      const setupStatus = r.setup?.status || 'never';

      // Level 1 gate (client-side branch): if the user has never wired up
      // Implexa in their Claude, send them to /install with a welcome
      // banner — the skill is in their library but useless until setup
      // completes. Same logic as the server-side bounceback page; we
      // duplicate it here because this code path bypasses the bounceback
      // (user was already authed when they hit the share preview).
      if (setupStatus === 'never') {
        const qs = new URLSearchParams({
          welcome:    '1',
          from_skill: r.skill.slug,
          token,
        });
        router.push(`/install?${qs.toString()}`);
        return;
      }

      const triggerPhrase = Array.isArray(r.skill.triggerPhrases) && r.skill.triggerPhrases.length > 0
        ? r.skill.triggerPhrases[0]
        : null;

      setInstalled({
        slug:          r.skill.slug,
        name:          r.skill.name,
        triggerPhrase,
        setupStatus,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Install failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  // Post-install: success state with Try-It CTA.
  // Renders TWO blocks: the "Installed" confirmation header, then a
  // "Now try it in Claude" hint card that uses the skill's first trigger
  // phrase to scaffold a real prompt the user can paste into Claude.
  if (installed) {
    return (
      <div className="flex flex-col items-end gap-3 max-w-md">
        <div className="text-right">
          <div className="text-sm font-medium text-brand-600">✓ Installed</div>
          {/* Jump straight to the forked skill's detail page (NOT the
            * library index). Lands the user on the actual skill they just
            * installed — they don't need to scroll-find it under "Your skills".
            * Previously this was router.push('/skills'), which dumped them
            * on the library with no clue where to look. */}
          <button
            onClick={() => router.push(`/skills/${installed.slug}`)}
            className="mt-1 text-xs text-ink-200 hover:underline"
          >
            Open &quot;{installed.name}&quot; →
          </button>
        </div>
        <TryItCard
          skillSlug={installed.slug}
          skillName={installed.name}
          triggerPhrase={installed.triggerPhrase}
        />
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

/**
 * Post-install hint card. Shows the user a concrete prompt to paste
 * into Claude so they immediately see the skill work. The prompt is
 * built from the skill's first trigger phrase (set by Haiku at skill
 * authorship time) — if no trigger phrase exists, we fall back to the
 * generic "run this skill" pattern.
 */
function TryItCard({
  skillSlug,
  skillName,
  triggerPhrase,
}: {
  skillSlug: string;
  skillName: string;
  triggerPhrase: string | null;
}) {
  // Build a natural-language prompt that maps to apply_org_skill via Claude's
  // routing. Prefix with "Implexa," so Claude knows to call the MCP tool
  // rather than answer freeform.
  const prompt = triggerPhrase
    ? `Implexa, ${triggerPhrase}`
    : `Implexa, run ${skillSlug}`;
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="w-full rounded-lg border border-success-400/40 bg-gradient-to-br from-success-400/8 to-brand-500/5 p-3">
      <div className="text-xs uppercase tracking-wider text-success-700 dark:text-success-400 font-bold mb-1.5">
        🚀 Try it now in Claude
      </div>
      <p className="text-xs text-ink-200 mb-2 leading-relaxed">
        Open any Claude surface (Code, Cowork, Desktop) and paste:
      </p>
      <div className="relative">
        <pre className="bg-ink-950 border border-ink-700 rounded px-2.5 py-2 text-xs font-mono text-ink-100 whitespace-pre-wrap break-words pr-12">
          {prompt}
        </pre>
        <button
          onClick={copy}
          className={`absolute top-1.5 right-1.5 text-[10px] uppercase tracking-wider font-medium rounded px-1.5 py-0.5 transition-colors ${
            copied
              ? 'bg-success-400/20 text-success-700 dark:text-success-400'
              : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100'
          }`}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-[10px] text-ink-400 mt-2 leading-relaxed">
        Claude will call <code className="text-[10px] bg-ink-800 px-1 rounded">apply_org_skill</code> and run <em>{skillName}</em> against your data.
      </p>
    </div>
  );
}
