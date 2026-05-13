'use client';

import { useState, useTransition } from 'react';
import { joinWaitlist, leaveWaitlist } from './actions';
import type { Integration } from '@/lib/integrations';

type Props = {
  integration: Integration;
  /** Is this user already on the waitlist for this integration? */
  alreadyOnWaitlist?: boolean;
  /** If shown in "Recommended for you" — surface the reason. */
  recommendationReason?: string;
  /** Highlight as recommended (emerald accent). */
  isRecommended?: boolean;
};

export default function IntegrationCard({
  integration,
  alreadyOnWaitlist = false,
  recommendationReason,
  isRecommended = false,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [onWaitlist, setOnWaitlist] = useState(alreadyOnWaitlist);
  const [error, setError] = useState<string | null>(null);

  const isAvailable = integration.status === 'available';
  const isBeta = integration.status === 'beta';
  const isComingSoon = integration.status === 'coming-soon';

  function handleWaitlistClick() {
    setError(null);
    startTransition(async () => {
      const action = onWaitlist ? leaveWaitlist : joinWaitlist;
      const result = await action(integration.slug);
      if (result.ok) setOnWaitlist(!onWaitlist);
      else setError(result.error);
    });
  }

  return (
    <div
      className={`card !p-4 flex flex-col gap-3 h-full ${
        isRecommended ? '!border-success-400/40 bg-gradient-to-b from-ink-900 to-success-50/10' : ''
      }`}
    >
      {/* Header — logo + name + status badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl shrink-0" aria-hidden="true">{integration.logo}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink-50 truncate">{integration.name}</div>
            <StatusBadge status={integration.status} />
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-ink-300 leading-relaxed flex-1">{integration.description}</p>

      {/* Recommendation reason — only if surfaced from workflow */}
      {recommendationReason && (
        <div className="text-xs text-success-700 dark:text-success-400 bg-success-50/40 dark:bg-success-900/20 rounded-md px-2 py-1.5">
          💡 {recommendationReason}
        </div>
      )}

      {/* Action — Connect (if available) OR Notify Me (if coming-soon) */}
      <div className="pt-1">
        {isAvailable && (
          <a
            href={`mailto:support@implexa.ai?subject=${encodeURIComponent(
              `Connect ${integration.name}`,
            )}&body=${encodeURIComponent(
              `I'd like to wire up ${integration.name} (${integration.authType === 'apikey' ? 'API key' : 'OAuth'}) to my Implexa org.\n\nMy ${integration.name} API key:\n[paste here — we encrypt at rest]\n\nAnything else we should know:\n`,
            )}`}
            className="btn-primary !py-1.5 !px-3 text-xs w-full inline-flex items-center justify-center gap-1.5"
          >
            Connect
            <span aria-hidden="true">→</span>
          </a>
        )}

        {isBeta && (
          <a
            href={`mailto:support@implexa.ai?subject=${encodeURIComponent(
              `Beta access — ${integration.name}`,
            )}`}
            className="btn-outline !py-1.5 !px-3 text-xs w-full inline-flex items-center justify-center gap-1.5"
          >
            Try the beta
            <span aria-hidden="true">→</span>
          </a>
        )}

        {isComingSoon && (
          <button
            type="button"
            onClick={handleWaitlistClick}
            disabled={isPending}
            className={`!py-1.5 !px-3 text-xs w-full rounded-md border transition-colors disabled:opacity-50 ${
              onWaitlist
                ? 'border-success-400/40 bg-success-400/10 text-success-700 dark:text-success-400 hover:bg-success-400/20'
                : 'border-ink-600 text-ink-200 hover:bg-ink-800 hover:border-ink-500'
            }`}
            aria-pressed={onWaitlist}
          >
            {isPending ? '…' : onWaitlist ? '✓ Notifying you when it ships' : 'Notify me when this ships'}
          </button>
        )}

        {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
      </div>

      {/* Auth type micro-label */}
      <div className="text-[10px] uppercase tracking-wider text-ink-400 -mt-1">
        {integration.authType === 'apikey' ? '🔑 API key' : '🔐 OAuth login'}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Integration['status'] }) {
  const map = {
    available:    { label: 'Available now', color: 'text-success-700 dark:text-success-400 bg-success-50/40 dark:bg-success-900/20' },
    beta:         { label: 'Beta',          color: 'text-accent-700 dark:text-accent-400 bg-accent-50/40 dark:bg-accent-900/20' },
    'coming-soon':{ label: 'Coming soon',   color: 'text-ink-400 bg-ink-800/50' },
  } as const;
  const { label, color } = map[status];
  return (
    <div className={`inline-block text-[10px] uppercase tracking-wider font-medium rounded px-1.5 py-0.5 mt-0.5 ${color}`}>
      {label}
    </div>
  );
}
