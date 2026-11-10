'use client';

import { useState } from 'react';
import { callBackend } from '@/lib/api';
import { joinTools, splitTools, toolsFor } from '@/lib/coach-tools';

// Kept in step with the backend's CATEGORIES (routes/coach-interest.js) and the
// CHECK in migration 0561.
export const CATEGORIES = [
  { id: 'video', label: 'Video' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'design', label: 'Design' },
  { id: 'writing', label: 'Writing' },
  { id: 'development', label: 'Development' },
  { id: 'sales', label: 'Sales' },
  { id: 'research', label: 'Research and analysis' },
  { id: 'other', label: 'Other' },
] as const;

export type CoachInterest = {
  categories?: string[] | null;
  talent: string;
  tools: string | null;
  work_url: string | null;
  notes: string | null;
};

const ERRORS: Record<string, string> = {
  talent_required: 'Tell us what you are great at.',
  invalid_work_url: 'The link to your work should start with http:// or https://.',
  invalid_categories: 'Pick from the listed kinds of work.',
  invalid_tools: 'That is a lot of tools. Please shorten the list.',
};

export default function CoachForm({
  jwt, email, saved, readFailed,
}: {
  jwt: string;
  email: string;
  saved: CoachInterest | null;
  readFailed: boolean;
}) {
  const [categories, setCategories] = useState<string[]>(saved?.categories ?? []);
  const [talent, setTalent] = useState(saved?.talent ?? '');
  const initialTools = splitTools(saved?.tools);
  const [pickedTools, setPickedTools] = useState<string[]>(initialTools.picked);
  const [otherTools, setOtherTools] = useState(initialTools.other);
  const [workUrl, setWorkUrl] = useState(saved?.work_url ?? '');
  const [notes, setNotes] = useState(saved?.notes ?? '');
  // Tags for the chosen categories, plus anything already picked so turning a
  // category off never hides (and silently keeps) a selected tool.
  const offeredTools = [...toolsFor(categories), ...pickedTools.filter((t) => !toolsFor(categories).includes(t))];
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState('saving');
    try {
      await callBackend('/api/v2/coach-interest', {
        jwt, method: 'POST',
        body: { categories, talent, tools: joinTools(pickedTools, otherTools), work_url: workUrl, notes },
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
      <fieldset className="space-y-2">
        <legend className="text-sm text-ink-300 mb-1">What kind of work do you do?</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const on = categories.includes(c.id);
            return (
              <label key={c.id}
                className={`cursor-pointer rounded-full border px-3 py-1 text-sm focus-within:ring-2 focus-within:ring-brand-500 ${on ? 'border-brand-500 bg-brand-500/15 text-ink-50' : 'border-ink-700 text-ink-300'}`}>
                <input type="checkbox" className="sr-only" checked={on}
                  onChange={() => setCategories((prev) => on ? prev.filter((x) => x !== c.id) : [...prev, c.id])} />
                {c.label}
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm text-ink-300 mb-1">Tools you use</legend>
        {offeredTools.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {offeredTools.map((t) => {
              const on = pickedTools.includes(t);
              return (
                <label key={t}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-sm focus-within:ring-2 focus-within:ring-brand-500 ${on ? 'border-brand-500 bg-brand-500/15 text-ink-50' : 'border-ink-700 text-ink-300'}`}>
                  <input type="checkbox" className="sr-only" checked={on}
                    onChange={() => setPickedTools((prev) => on ? prev.filter((x) => x !== t) : [...prev, t])} />
                  {t}
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-ink-400">Pick the kind of work you do above to see common tools.</p>
        )}
        <input maxLength={400} value={otherTools} onChange={(e) => setOtherTools(e.target.value)}
          placeholder="Other tools, separated by commas" className="input" />
      </fieldset>
      <label className="block space-y-1">
        <span className="text-sm text-ink-300">What are you great at?</span>
        <textarea required maxLength={500} rows={3} value={talent} onChange={(e) => setTalent(e.target.value)}
          placeholder="e.g. editing YouTube explainers, performance marketing for DTC brands" className="input" />
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
