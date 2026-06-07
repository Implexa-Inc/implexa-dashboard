'use client';

import { useState } from 'react';

/**
 * The conversation box: "you talk to Implexa". Per the two-surface model, the
 * web dashboard captures the intent and hands off to the user's AI app (the
 * worker) to actually build the agent, rather than pretending to build it
 * server-side. v1 copies a ready-to-paste instruction; the full intent router
 * (create / tune / review / schedule) and a build-request handoff land next.
 */
export default function TalkToImplexa() {
  const [intent, setIntent] = useState('');
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    const t = intent.trim();
    if (!t) return;
    const instruction = `implexa, build an agent that ${t}`;
    try {
      await navigator.clipboard.writeText(instruction);
      setCopied(true);
      setTimeout(() => setCopied(false), 5000);
    } catch {
      /* clipboard blocked; the button still reflects intent */
    }
  };

  return (
    <section className="mb-8">
      <div className="card p-4">
        <label htmlFor="talk" className="text-sm font-medium text-ink-100">
          Tell Implexa what to do
        </label>
        <p className="text-xs text-ink-400 mt-0.5 mb-3">
          Describe a recurring job. Implexa builds the agent; it runs in your connected Claude or Codex, as you.
        </p>
        <div className="flex gap-2">
          <input
            id="talk"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. every morning, send me my key numbers"
            className="flex-1 rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-brand-500"
          />
          <button
            onClick={submit}
            className="rounded-md bg-brand-500 text-ink-950 px-4 py-2 text-sm font-medium hover:bg-brand-400 whitespace-nowrap transition-colors"
          >
            {copied ? 'Copied' : 'Build it'}
          </button>
        </div>
        {copied && (
          <p className="text-xs text-ink-300 mt-2">
            Copied. Paste it into your Claude or Codex to build the agent, then it shows up under Your agents below.
          </p>
        )}
      </div>
    </section>
  );
}
