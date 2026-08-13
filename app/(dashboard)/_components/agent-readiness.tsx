'use client';

/**
 * <AgentReadiness /> — the compact readiness line that REPLACED the permanent
 * "What you'll need" panel on Overview.
 *
 * WHY THE PANEL LEFT (founder, 2026-07-18): "What you'll need" is
 * PROVISIONING — keys, tools, accounts. It is satisfiable, it belongs to
 * activation, and once satisfied it should disappear. Instead it lived on
 * Overview forever, never reflected satisfaction, and showed a cost badge and a
 * "Get it ↗" link next to a key that already said "key ready" — inviting the user
 * to go buy something they already had.
 *
 * Meanwhile the thing that actually stops a run — unanswered required questions —
 * sat behind the Setup tab under a small dot. Exactly inverted: the satisfiable
 * thing was permanent furniture, the blocking thing was hidden.
 *
 * So Overview now states readiness in one line and points at what to do about it.
 * The provisioning detail lives in Activate, where it can be finished and then
 * collapse.
 */

import Link from 'next/link';

export type ReadinessProps = {
  slug: string;
  isActive: boolean;
  /** Unanswered questions that BLOCK a run (required only). */
  blockingQuestions: number;
  /** Unanswered preferences — never a blocker. */
  optionalQuestions: number;
  /** Server-computed: every detected paid service has a key on this Mac. */
  requirementsSatisfied: boolean;
  /** Names of the services still missing a key, for an honest one-line summary. */
  missingServices?: string[];
};

export default function AgentReadiness({
  slug, isActive, blockingQuestions, optionalQuestions, requirementsSatisfied, missingServices = [],
}: ReadinessProps) {
  // Ordered by what actually stops the user, most-blocking first. Only ONE state
  // renders — a stack of warnings is how the old panel became noise.
  const blocked = blockingQuestions > 0;
  const needsKeys = !requirementsSatisfied && missingServices.length > 0;

  if (!isActive && !blocked && !needsKeys) return null;

  const tone = blocked || needsKeys
    ? 'border-amber-500/40 bg-amber-500/[0.06]'
    : 'border-emerald-500/40 bg-emerald-500/[0.07]';

  function openSetup() {
    // This action lives in Overview while the Setup panel is not rendered. Ask
    // AgentTabs to open it — it owns the ?tab= URL and the navigation that
    // server-renders that panel. (This used to also replaceState the URL by
    // hand; that fought the router for ownership of the same query param and
    // is now AgentTabs' job alone.) Then find the first unanswered required
    // field once the panel and its async setup card have landed.
    try {
      window.dispatchEvent(new CustomEvent('implexa-open-tab', { detail: { key: 'setup' } }));
    } catch { /* best effort; the retries below still handle an already-open panel */ }

    let tries = 0;
    const revealMissingAnswer = () => {
      const setup = document.getElementById('agent-setup');
      const field = setup?.querySelector<HTMLElement>(
        '[data-setup-required="true"][data-setup-missing="true"] input, ' +
        '[data-setup-required="true"][data-setup-missing="true"] select, ' +
        '[data-setup-required="true"][data-setup-missing="true"] textarea',
      );
      if (field) {
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        field.focus({ preventScroll: true });
        try { window.dispatchEvent(new CustomEvent('implexa-flash-setup')); } catch { /* best effort */ }
        return;
      }
      if (setup && !blocked) {
        setup.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // The Setup panel now arrives via a server round-trip (AgentTabs
      // navigates to ?tab=setup) and its questions mount asynchronously after
      // that, so the retry window has to cover both. Bounded, so a failed setup
      // fetch cannot leave a permanent timer behind.
      if (++tries < 25) window.setTimeout(revealMissingAnswer, 120);
    };
    window.setTimeout(revealMissingAnswer, 0);
  }

  return (
    <div className={`rounded-lg border ${tone} px-4 py-3 mb-6 flex items-start justify-between gap-3 flex-wrap`}>
      <div className="min-w-0">
        {blocked ? (
          <>
            <div className="text-sm font-semibold text-ink-100">
              {isActive ? 'Activated' : 'Not ready'} — {blockingQuestions} answer{blockingQuestions === 1 ? '' : 's'} needed to run
            </div>
            {/* Say WHY, so this doesn't read as bureaucracy: these are the answers
                the agent cannot produce a correct result without. */}
            <p className="text-sm text-ink-300 leading-relaxed mt-0.5">
              This agent can’t produce the right result until {blockingQuestions === 1 ? 'this is' : 'these are'} answered.
            </p>
          </>
        ) : needsKeys ? (
          <>
            <div className="text-sm font-semibold text-ink-100">Needs a key to run</div>
            <p className="text-sm text-ink-300 leading-relaxed mt-0.5">
              Still missing: {missingServices.join(', ')}.
            </p>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold text-ink-100">Ready to run</div>
            <p className="text-sm text-ink-300 leading-relaxed mt-0.5">
              Everything it needs is set up
              {optionalQuestions > 0
                ? ` — ${optionalQuestions} optional preference${optionalQuestions === 1 ? '' : 's'} you can still set.`
                : '.'}
            </p>
          </>
        )}
      </div>
      {/* THE CTA MUST NOT CONTRADICT THE HEADLINE (founder, 2026-07-24: "Ready to
          run dialog with a Finish Setup is paradoxical").
          The fall-through branch used to render "Finish setup" — but note the
          early return above: when nothing is blocked and no key is missing, this
          card only renders AT ALL for an ACTIVE agent. So that branch was
          unreachable except in exactly the state where there is nothing left to
          finish, telling a ready, activated agent's owner to go finish setting it
          up. Ready keeps a way IN to the provisioning detail, worded as what it
          actually is — a review, not unfinished work. */}
      {blocked || optionalQuestions > 0 ? (
        <button
          type="button"
          onClick={openSetup}
          className="btn-outline text-sm px-4 py-2 flex-none"
        >
          {blocked ? `Answer ${blockingQuestions}` : 'Edit setup'}
        </button>
      ) : (
        <Link href={`/workflows/${slug}/activate`} className="btn-outline text-sm px-4 py-2 flex-none">
          Review setup
        </Link>
      )}
    </div>
  );
}
