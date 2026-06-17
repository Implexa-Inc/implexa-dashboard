'use client';

/**
 * <PrerequisitesChecklist /> — the "what you need installed" list for guided
 * (novice/beginner) users, per the desktop-first posture (locked 2026-06-13).
 *
 * Self-detecting inside the desktop app. When the bridge (window.implexaDesktop)
 * is present we know real local state and mark steps done instead of nagging:
 *   1. Install the Implexa app  → the bridge existing means we ARE in the app.
 *   2. Install Claude/Codex     → detectAgents() (apps on disk) ‖ a live connection.
 *   3. Add the Chrome extension → detectExtensions() (Claude/Codex ext on disk).
 * In a plain browser (no bridge) we can't read the disk, so we fall back to the
 * server `connected` hint for step 2 and leave the rest as to-dos.
 *
 * `connected` (server prop) = an active API key exists, the web-knowable signal.
 */

import { useEffect, useState } from 'react';
import { macDownloadUrl } from '@/lib/app-links';

type Bridge = {
  detectAgents?: () => Promise<{ claude?: boolean; codex?: boolean }>;
  detectExtensions?: () => Promise<{ claude?: boolean; codex?: boolean }>;
};

type Link = { label: string; href: string };

export default function PrerequisitesChecklist({ connected = false }: { connected?: boolean }) {
  // Detection state. null = not yet checked (SSR / first paint).
  const [det, setDet] = useState<{ inApp: boolean; agents: boolean; ext: boolean } | null>(null);

  useEffect(() => {
    const bridge = typeof window !== 'undefined'
      ? (window as Window & { implexaDesktop?: Bridge }).implexaDesktop
      : undefined;
    if (!bridge) {
      // Plain browser: can't read the disk. Only step 2 is web-knowable.
      setDet({ inApp: false, agents: connected, ext: false });
      return;
    }
    let cancelled = false;
    (async () => {
      let agents = connected;
      let ext = false;
      try { const a = await bridge.detectAgents?.(); if (a) agents = !!(a.claude || a.codex) || connected; } catch { /* keep connected */ }
      try { const e = await bridge.detectExtensions?.(); if (e) ext = !!(e.claude || e.codex); } catch { /* leave as to-do */ }
      if (!cancelled) setDet({ inApp: true, agents, ext }); // bridge present ⇒ the Implexa app is installed
    })();
    return () => { cancelled = true; };
  }, [connected]);

  const steps = [
    {
      title: 'Get the Implexa app',
      body: 'One click, and it does the rest: it connects Implexa to your own Claude or Codex and sets up the browser extension for you, so steps 2 and 3 below happen automatically. Signed and notarized by Apple.',
      links: [
        { label: '↓ Download for Mac', href: macDownloadUrl() },
      ] as Link[],
      done: det?.inApp ?? false,
      doneNote: "You're using the Implexa app.",
    },
    {
      title: 'Have Claude or Codex installed',
      body: 'Your agents run inside your own Claude Code or Codex (not the web chat). The Implexa app installs Implexa into them for you. If you do not have Claude or Codex yet, grab one:',
      links: [
        { label: 'Get Claude', href: 'https://claude.ai/download' },
        { label: 'Get Codex', href: 'https://openai.com/codex' },
      ] as Link[],
      done: det?.agents ?? connected,
      doneNote: 'Detected — your Claude or Codex is connected to Implexa.',
    },
    {
      title: 'Browser extension (only for browser agents)',
      body: 'Some agents drive a real browser (sign into a site, post a reel, scrape a page). The Implexa app sets this up for you; install manually only if you prefer. Optional until you build an agent that needs it.',
      links: [
        { label: 'Claude for Chrome', href: 'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn?hl=en-US' },
        { label: 'Codex for Chrome', href: 'https://chromewebstore.google.com/detail/codex/hehggadaopoacecdllhhajmbjkdcmajg?hl=en-US' },
      ] as Link[],
      done: det?.ext ?? false,
      doneNote: 'Detected — the Claude or Codex extension is installed.',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  // Once everything is detected, a wall of green checks is just noise — hide the
  // whole checklist. We wait for detection (det != null) so a genuinely-unset-up
  // user still sees it on first paint instead of it flashing away.
  if (det && doneCount === steps.length) return null;

  return (
    <section className="card mb-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-100">Before your agents can run, you&apos;ll need a few things</h2>
        <span className="text-xs text-ink-500 tabular-nums">{doneCount}/{steps.length} ready</span>
      </div>
      <p className="text-xs text-ink-500 mt-1 mb-4">A one-time setup. We&apos;ll keep it simple.</p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            {s.done ? (
              <span className="flex-none inline-flex items-center justify-center w-6 h-6 rounded-full bg-success-400/15 text-success-600 dark:text-success-400 mt-0.5" aria-label="Done">
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </span>
            ) : (
              <span className="flex-none inline-flex items-center justify-center w-6 h-6 rounded-full bg-ink-800 text-ink-300 text-[11px] font-semibold tabular-nums mt-0.5">
                {i + 1}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-medium ${s.done ? 'text-ink-300 line-through decoration-ink-600' : 'text-ink-100'}`}>{s.title}</span>
              </div>
              {s.done ? (
                <p className="text-xs text-success-600 dark:text-success-400 mt-0.5 leading-relaxed">{s.doneNote}</p>
              ) : (
                <>
                  <p className="text-xs text-ink-400 mt-0.5 leading-relaxed">{s.body}</p>
                  {s.links && s.links.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-4 flex-wrap">
                      {s.links.map((l) => (
                        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-brand-500 hover:underline">
                          {l.label} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
