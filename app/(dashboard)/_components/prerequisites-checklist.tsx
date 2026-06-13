/**
 * <PrerequisitesChecklist /> , the "what you need installed" list for guided
 * (novice/beginner) users, per the desktop-first posture (locked 2026-06-13).
 *
 * Agents run in a LOCAL agent runtime, not a web chat, so a novice needs a few
 * things in place. Shown honestly for TODAY: the Implexa app is days away (the
 * command below is the interim connect), while the Claude/Codex DESKTOP app and
 * the Chrome extension are real prerequisites right now. Server component.
 */

type Step = {
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
  badge?: string;
};

const STEPS: Step[] = [
  {
    title: 'Install the Implexa app',
    body: 'The one-click home for building, activating, and running your agents. Coming in the next few days. For now, connect with the command below.',
    badge: 'Coming soon',
  },
  {
    title: 'Install the Claude or Codex desktop app',
    body: 'Your agents run inside your own Claude Code or Codex, on your computer. They do NOT work in the web chat interfaces, so you need the desktop app.',
    href: 'https://claude.ai/download',
    hrefLabel: 'Get Claude',
  },
  {
    title: 'Add the Chrome extension (for browser agents)',
    body: 'Some agents drive a real browser (sign into a site, post a reel, scrape a page). The Claude for Chrome extension lets them do that as you. Optional until you build one that needs it.',
  },
];

export default function PrerequisitesChecklist() {
  return (
    <section className="card mb-6">
      <h2 className="text-sm font-medium text-ink-100">Before your agents can run, you&apos;ll need a few things</h2>
      <p className="text-xs text-ink-500 mt-1 mb-4">A one-time setup. We&apos;ll keep it simple.</p>
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span className="flex-none inline-flex items-center justify-center w-6 h-6 rounded-full bg-ink-800 text-ink-300 text-[11px] font-semibold tabular-nums mt-0.5">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink-100">{s.title}</span>
                {s.badge && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">{s.badge}</span>
                )}
              </div>
              <p className="text-xs text-ink-400 mt-0.5 leading-relaxed">{s.body}</p>
              {s.href && (
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-1.5 text-xs text-brand-500 hover:underline"
                >
                  {s.hrefLabel || 'Open'} ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
