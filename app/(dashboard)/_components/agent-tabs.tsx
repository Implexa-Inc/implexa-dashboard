'use client';

/**
 * <AgentTabs /> , the agent everything-page split into tabs (Overview / Runs /
 * Setup) instead of one long scroll. The 2-section redesign: Your Agents -> one
 * agent's page, where tabs organize the depth and a tab can carry an attention
 * dot (e.g. Setup has unanswered questions or a signed-out account).
 *
 * The panels are server-rendered (passed in as ReactNodes); this client shell
 * only owns which one is visible. Deep-link via ?tab=runs is honored on mount.
 */

import { useState } from 'react';

export type TabDef = { key: string; label: string; attention?: boolean };

export default function AgentTabs({
  tabs,
  panels,
  initial,
}: {
  tabs: TabDef[];
  panels: Record<string, React.ReactNode>;
  initial?: string;
}) {
  const first = tabs[0]?.key;
  const [active, setActive] = useState(
    initial && tabs.some((t) => t.key === initial) ? initial : first,
  );

  return (
    <div>
      <div role="tablist" aria-label="Agent sections" className="flex gap-1 border-b border-ink-800 mb-6 overflow-x-auto">
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t.key)}
              className={`relative -mb-px px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                on
                  ? 'border-brand-500 text-ink-50'
                  : 'border-transparent text-ink-400 hover:text-ink-100'
              }`}
            >
              {t.label}
              {t.attention && (
                <span
                  className="absolute top-1.5 -right-0.5 inline-block size-2 rounded-full bg-amber-400"
                  aria-label="needs you"
                />
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{panels[active]}</div>
    </div>
  );
}
