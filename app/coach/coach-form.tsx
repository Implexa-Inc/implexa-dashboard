'use client';

import { useState } from 'react';
import { callBackend } from '@/lib/api';

export type CoachInterest = {
  talent: string;
  tools: string | null;
  work_url: string | null;
  notes: string | null;
};

const ERRORS: Record<string, string> = {
  talent_required: 'Tell us what you are great at.',
  invalid_work_url: 'The link to your work should start with http:// or https://.',
};

export default function CoachForm({
  jwt, email, saved, readFailed,
}: {
  jwt: string;
  email: string;
  saved: CoachInterest | null;
  readFailed: boolean;
}) {
  const [talent, setTalent] = useState(saved?.talent ?? '');
  const [tools, setTools] = useState(saved?.tools ?? '');
  const [workUrl, setWorkUrl] = useState(saved?.work_url ?? '');
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState('saving');
    try {
      await callBackend('/api/v2/coach-interest', {
        jwt, method: 'POST',
        body: { talent, tools, work_url: workUrl, notes },
      });
      setState('done');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(ERRORS[code] ?? 'We could not save that. Please try again.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <div className="card space-y-2">
        <p className="text-ink-50 font-medium">Thanks, you&apos;re on the list.</p>
        <p className="text-sm text-ink-300">We&apos;ll email you at {email} before launch. You can come back to this page any time to update your answers.</p>
        <button type="button" onClick={() => setState('idle')} className="btn-outline mt-2">Edit my answers</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      {readFailed && (
        <p role="alert" className="text-sm text-amber-300">
          We could not load answers you may have sent before. Sending this form replaces them.
        </p>
      )}
      {saved && !readFailed && (
        <p className="text-sm text-ink-300">You&apos;re already on the list. Update your answers below.</p>
      )}
      <label className="block space-y-1">
        <span className="text-sm text-ink-300">Email</span>
        <input type="email" value={email} readOnly className="input opacity-70" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-ink-300">What are you great at?</span>
        <textarea required maxLength={500} rows={3} value={talent} onChange={(e) => setTalent(e.target.value)}
          placeholder="e.g. editing YouTube explainers, performance marketing for DTC brands" className="input" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-ink-300">Tools you use</span>
        <input maxLength={500} value={tools} onChange={(e) => setTools(e.target.value)}
          placeholder="e.g. Premiere Pro, After Effects, Remotion, HeyGen" className="input" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-ink-300">Link to your work (optional)</span>
        <input type="url" maxLength={500} value={workUrl} onChange={(e) => setWorkUrl(e.target.value)}
          placeholder="https://" className="input" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-ink-300">Anything else we should know? (optional)</span>
        <textarea maxLength={1000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
      </label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={state === 'saving'} className="btn-primary w-full">
        {state === 'saving' ? 'Sending…' : saved ? 'Update my answers' : 'Sign up to train agents'}
      </button>
    </form>
  );
}
