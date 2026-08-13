'use client';

/**
 * <AgentTabs /> — the agent everything-page split into tabs (Overview / Runs /
 * Setup) instead of one long scroll.
 *
 * WHY THIS IS URL-DRIVEN (2026-08 perf work): all three panels used to be
 * server-rendered on every page view and handed here as ReactNodes, so opening
 * Overview still paid to build and serialize the Runs list AND the whole Setup
 * tree (activation card + a second <AgentActions/> + the learnings card) — the
 * two heaviest subtrees on the page, for content nobody was looking at. Now the
 * server renders ONLY the active tab's panel and switching tabs is a real
 * navigation to ?tab=…, so each tab's expensive tree is built when it is
 * actually opened.
 *
 * NO FLICKER: the switch runs inside useTransition, so React keeps the current
 * panel mounted and visible while the next one streams in — the tab strip
 * reflects the pending tab immediately and the outgoing panel just dims. There
 * is no blank frame and no spinner replacing content that was already there.
 * The header, banners, and lifecycle labels live OUTSIDE this shell and are
 * unaffected by a tab switch, so no label can go stale mid-transition.
 */

import { useEffect, useOptimistic, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type TabDef = { key: string; label: string; attention?: boolean };

export default function AgentTabs({
  tabs,
  panel,
  active,
}: {
  tabs: TabDef[];
  /** ONLY the active tab's server-rendered tree. */
  panel: React.ReactNode;
  /** The resolved active tab (server-side, from ?tab= with a safe fallback). */
  active: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // The tab strip must respond to the click instantly even though the panel
  // arrives from the server a moment later; this optimistic value is reverted
  // automatically if the navigation is abandoned.
  const [shown, showTab] = useOptimistic(active);

  function openTab(key: string) {
    if (key === active) return;
    const next = new URLSearchParams(searchParams.toString());
    if (key === tabs[0]?.key) next.delete('tab');
    else next.set('tab', key);
    const qs = next.toString();
    startTransition(() => {
      showTab(key);
      // scroll:false — a tab switch must not yank the viewport to the top.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  // Let sibling components (e.g. the "Answer N questions to run" button in the
  // header, which lives OUTSIDE this shell) switch tabs. Without this, that
  // button tried to scroll to #agent-setup while the Setup panel was unmounted,
  // so it silently did nothing.
  useEffect(() => {
    function onOpenTab(e: Event) {
      const key = (e as CustomEvent).detail?.key;
      if (key && tabs.some((t) => t.key === key)) openTab(key);
    }
    window.addEventListener('implexa-open-tab', onOpenTab as EventListener);
    return () => window.removeEventListener('implexa-open-tab', onOpenTab as EventListener);
  });

  return (
    <div>
      <div role="tablist" aria-label="Agent sections" className="flex gap-1 border-b border-ink-800 mb-6 overflow-x-auto">
        {tabs.map((t) => {
          const on = shown === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => openTab(t.key)}
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
      {/* aria-busy + a dim, never a replacement: the outgoing panel stays on
          screen and readable until the incoming one is ready. */}
      <div
        role="tabpanel"
        aria-busy={isPending || undefined}
        className={isPending ? 'opacity-60 transition-opacity' : undefined}
      >
        {panel}
      </div>
    </div>
  );
}
