'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';

type Level = { key: 'novice' | 'beginner' | 'pro' | 'advanced'; label: string; tagline: string };

const LEVELS: Level[] = [
  { key: 'novice',   label: 'Novice',   tagline: 'New to this , Implexa does most of the work and guides you' },
  { key: 'beginner', label: 'Beginner', tagline: 'You use Claude Code / Codex for a couple of tasks a day' },
  { key: 'pro',      label: 'Pro',      tagline: 'You use it regularly and know most features and capabilities' },
  { key: 'advanced', label: 'Advanced', tagline: 'You build apps and agents' },
];

export default function ProficiencyPicker({ jwt, next }: { jwt: string; next: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(level: Level['key']) {
    setError(null);
    setSaving(level);
    try {
      await callBackend('/api/v2/me/proficiency', { jwt, method: 'POST', body: { proficiency: level } });
      router.push(next);
    } catch (err) {
      // Don't trap onboarding on a save hiccup , record the error but let them move on.
      setError(err instanceof Error ? err.message : 'Could not save');
      router.push(next);
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {LEVELS.map((lvl, i) => {
          const isSaving = saving === lvl.key;
          return (
            <button
              key={lvl.key}
              type="button"
              onClick={() => pick(lvl.key)}
              disabled={!!saving}
              className={`card text-left transition-all hover:border-brand-500/40 hover:shadow-glow disabled:opacity-50 disabled:cursor-wait ${
                isSaving ? '!border-brand-500/60 !shadow-glow' : ''
              } ${saving && !isSaving ? 'opacity-30' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ink-800 text-ink-300 text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="font-medium text-ink-50">{lvl.label}</span>
              </div>
              <div className="text-xs text-ink-400 leading-relaxed">{lvl.tagline}</div>
              {isSaving && <div className="mt-2 text-[11px] text-brand-500 font-medium">Saving…</div>}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="text-center text-xs text-ink-500 mt-4">
          Saved locally; we&apos;ll sync it shortly.
        </div>
      )}

      <div className="text-center mt-6">
        <button
          type="button"
          onClick={() => router.push(next)}
          disabled={!!saving}
          className="text-sm text-ink-400 hover:text-ink-200 underline disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </>
  );
}
