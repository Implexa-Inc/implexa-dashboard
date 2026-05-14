'use client';

/**
 * Platform-wide announcements banner — pulled from the backend's
 * /api/v2/announcements endpoint. Fully founder-controlled via the
 * backend's src/config/announcements.js — push a backend change,
 * announcements appear without any dashboard deploy or plugin reinstall.
 *
 * Dismissal: per-announcement-id, stored in localStorage so the same
 * banner doesn't reappear for that user across page loads. Backend doesn't
 * track dismissals — keeps the implementation tier-1 simple.
 */

import { useEffect, useState } from 'react';

type Announcement = {
  id:       string;
  severity: 'info' | 'warning' | 'urgent' | 'celebration';
  icon?:    string;
  message:  string;
  body?:    string;
  ctaText?: string;
  ctaUrl?:  string;
  dismissible?: boolean;
};

const DISMISSED_KEY = 'implexa-dismissed-announcements';

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(set)));
  } catch { /* localStorage full or disabled — fine, banner reappears next session */ }
}

export default function AnnouncementsBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissedIds,  setDismissedIds]  = useState<Set<string>>(new Set());
  const [loaded,        setLoaded]        = useState(false);

  // Fetch active announcements from the backend on mount. Errors are
  // silent — announcements are non-essential, never block the page.
  useEffect(() => {
    setDismissedIds(loadDismissed());

    let canceled = false;
    (async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://core.implexa.ai';
        const res = await fetch(`${apiUrl}/api/v2/announcements`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (canceled) return;
        setAnnouncements(Array.isArray(data?.announcements) ? data.announcements : []);
      } catch {
        // ignore — banner just doesn't show
      } finally {
        if (!canceled) setLoaded(true);
      }
    })();
    return () => { canceled = true; };
  }, []);

  function dismiss(id: string) {
    const next = new Set(dismissedIds);
    next.add(id);
    setDismissedIds(next);
    saveDismissed(next);
  }

  if (!loaded) return null;

  const visible = announcements.filter(a => !dismissedIds.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      {visible.map((a) => (
        <AnnouncementCard key={a.id} announcement={a} onDismiss={() => dismiss(a.id)} />
      ))}
    </div>
  );
}

function AnnouncementCard({ announcement, onDismiss }: { announcement: Announcement; onDismiss: () => void }) {
  const { id, severity, icon, message, body, ctaText, ctaUrl, dismissible } = announcement;

  // Visual severity tiers — borders + accent color hints. Celebration =
  // emerald (positive milestone), info = brand vermilion (neutral notice),
  // warning = accent ember (needs attention but not urgent),
  // urgent = red (action required).
  const styleMap: Record<Announcement['severity'], string> = {
    celebration: 'border-success-400/40 bg-success-400/5',
    info:        'border-brand-500/40 bg-brand-500/5',
    warning:     'border-accent-400/40 bg-accent-400/5',
    urgent:      'border-red-500/40 bg-red-500/5',
  };

  const isDismissible = dismissible !== false;

  return (
    <div
      className={`card !p-4 flex items-start gap-4 ${styleMap[severity]}`}
      role="status"
      aria-live="polite"
    >
      {icon && <div className="text-2xl shrink-0 leading-none mt-0.5" aria-hidden="true">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-50">{message}</div>
        {body && <div className="text-xs text-ink-300 mt-1 leading-relaxed">{body}</div>}
        {ctaUrl && ctaText && (
          <a
            href={ctaUrl}
            target={ctaUrl.startsWith('http') ? '_blank' : undefined}
            rel={ctaUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
            className="inline-block mt-2 text-xs font-medium text-brand-500 hover:underline"
          >
            {ctaText} →
          </a>
        )}
      </div>
      {isDismissible && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss announcement ${id}`}
          className="shrink-0 text-ink-500 hover:text-ink-200 transition-colors text-lg leading-none px-1"
        >
          ✕
        </button>
      )}
    </div>
  );
}
