'use client';

/**
 * <AgentNameEditor /> , inline rename for an agent's display name.
 *
 * System-generated agent names are often hard to recognize, so the owner can
 * give it a human name right on its page (a pencil next to the title). Slug
 * stays the same (it's the stable id); only the display name changes. Editable
 * only for the caller's own generated agents (the backend enforces ownership).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export default function AgentNameEditor({
  slug,
  source,
  initialName,
  editable,
}: {
  slug: string;
  source: string;
  initialName: string;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    return <h1 className="text-3xl font-semibold tracking-tight text-ink-50">{name}</h1>;
  }

  async function save() {
    const next = draft.trim();
    if (next.length < 2 || next === name) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/workflows/rename', {
        jwt: session?.access_token, method: 'POST', body: { slug, source, name: next },
      });
      setName(res?.name || next);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(name); setEditing(false); } }}
          maxLength={120}
          className="text-2xl font-semibold tracking-tight bg-ink-900 border border-ink-600 rounded-md px-2 py-1 text-ink-50 focus:border-brand-500/60 focus:outline-none min-w-[260px]"
        />
        <button type="button" onClick={save} disabled={saving} className="btn-success text-xs px-3 py-1.5 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => { setDraft(name); setEditing(false); }} className="text-xs text-ink-400 hover:text-ink-200">Cancel</button>
        {error && <span className="text-xs text-rose-600 dark:text-rose-400 w-full">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <h1 className="text-3xl font-semibold tracking-tight text-ink-50">{name}</h1>
      <button
        type="button"
        onClick={() => { setDraft(name); setEditing(true); }}
        aria-label="Rename agent"
        title="Rename"
        className="text-ink-500 hover:text-ink-200 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
      >
        ✎
      </button>
    </div>
  );
}
