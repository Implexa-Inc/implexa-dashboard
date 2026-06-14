/**
 * <PrerequisitesChecklist /> , the "what you need installed" list for guided
 * (novice/beginner) users, per the desktop-first posture (locked 2026-06-13).
 *
 * Agents run in a LOCAL agent runtime, not a web chat, so a novice needs a few
 * things in place. Shown honestly for TODAY: the Implexa app is days away (the
 * command below is the interim connect), while the Claude/Codex DESKTOP app and
 * the Chrome extension are real prerequisites right now.
 *
 * Detection: when `connected` is true (the dashboard has seen a live hook/MCP
 * connection for this user), the "install the desktop app" step is already
 * satisfied — we mark it done rather than asking the user to do something they
 * clearly already did. (Full local-app detection — "is Claude.app on disk" —
 * is the Implexa desktop app's job; the web can only know the connection
 * succeeded, which is the meaningful signal anyway.) Server component.
 */

type Link = { label: string; href: string };

type Step = {
  title: string;
  body: string;
  links?: Link[];
  badge?: string;
  /** When true, this step renders in a completed (green check) state. */
  done?: boolean;
  doneNote?: string;
};

export default function PrerequisitesChecklist({ connected = false }: { connected?: boolean }) {
  const steps: Step[] = [
    {
      title: 'Install the Implexa app',
      body: 'The one-click home for building, activating, and running your agents. Coming in the next few days. For now, connect with the command below.',
      badge: 'Coming soon',
    },
    {
      title: 'Install the Claude or Codex desktop app',
      body: 'Your agents run inside your own Claude Code or Codex, on your computer. They do NOT work in the web chat interfaces, so you need the desktop app.',
      links: [
        { label: 'Get Claude', href: 'https://claude.ai/download' },
        { label: 'Get Codex', href: 'https://openai.com/codex' },
      ],
      done: connected,
      doneNote: 'Detected — your Claude or Codex is connected to Implexa.',
    },
    {
      title: 'Add the Chrome extension (for browser agents)',
      body: 'Some agents drive a real browser (sign into a site, post a reel, scrape a page). The extension lets them do that as you. Optional until you build one that needs it.',
      links: [
        { label: 'Claude for Chrome', href: 'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn?hl=en-US' },
        { label: 'Codex for Chrome', href: 'https://chromewebstore.google.com/detail/codex/hehggadaopoacecdllhhajmbjkdcmajg?hl=en-US' },
      ],
    },
  ];

  return (
    <section className="card mb-6">
      <h2 className="text-sm font-medium text-ink-100">Before your agents can run, you&apos;ll need a few things</h2>
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
                {s.badge && !s.done && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">{s.badge}</span>
                )}
              </div>
              {s.done && s.doneNote ? (
                <p className="text-xs text-success-600 dark:text-success-400 mt-0.5 leading-relaxed">{s.doneNote}</p>
              ) : (
                <>
                  <p className="text-xs text-ink-400 mt-0.5 leading-relaxed">{s.body}</p>
                  {s.links && s.links.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-4 flex-wrap">
                      {s.links.map((l) => (
                        <a
                          key={l.href}
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-xs text-brand-500 hover:underline"
                        >
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
