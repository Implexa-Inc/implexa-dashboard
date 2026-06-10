'use client';

/**
 * <BackLink /> — history-aware back navigation.
 *
 * The dashboard renders inside the desktop app's webview, where there is no
 * browser chrome: every hard-coded "← Agents" link teleported the user to a
 * fixed parent instead of where they actually came from (founder: "I expect a
 * back button on every navigation"). This goes BACK when there is history and
 * falls back to the given route on a cold landing (deep link, notification).
 */

import { useRouter } from 'next/navigation';

export default function BackLink({ fallback, label, className }: {
  /** Where to go when there is no history (deep link / fresh window). */
  fallback: string;
  /** Visible label, e.g. "Back" or "Agents". */
  label: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        // history.length includes the current entry; >1 means there is
        // somewhere to go back to within this window.
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className={className || 'inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-200 transition-colors'}
    >
      <span aria-hidden>&larr;</span> {label}
    </button>
  );
}
