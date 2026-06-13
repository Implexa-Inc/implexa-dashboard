'use client';

/**
 * <FirstWinMoment /> , the celebration that pulls the user toward agent #2.
 *
 * The audit's north-star: "Your first agent is live and just ran, nice" + one
 * tailored next agent, one tap to re-enter the now-frictionless loop. Fires ONCE
 * (localStorage), only for an early user (their first 1-3 delivered runs), so it
 * never nags a returning power user. The "build next" button prefills the Home
 * build box (via a custom event TalkToImplexa listens for) so the loop restarts
 * with zero typing.
 */

import { useEffect, useState } from 'react';

const FLAG = 'implexa_first_win_shown';

export default function FirstWinMoment({
  delivered,
  nextTitle,
  nextIntent,
}: {
  delivered: number;
  nextTitle?: string | null;
  nextIntent?: string | null;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (delivered < 1 || delivered > 3) return; // genuinely-early users only
    try {
      if (window.localStorage.getItem(FLAG)) return;
    } catch { /* private mode: just show once this load */ }
    setShow(true);
  }, [delivered]);

  function close() {
    try { window.localStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
    setShow(false);
  }

  function buildNext() {
    const prompt = (nextIntent || '').trim();
    try { window.dispatchEvent(new CustomEvent('implexa-prefill-build', { detail: prompt })); } catch { /* best effort */ }
    close();
  }

  if (!show) return null;

  return (
    <section className="card-glow mb-8 relative">
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-ink-500 hover:text-ink-200 text-lg leading-none"
      >
        ×
      </button>
      <div className="text-2xl mb-1" aria-hidden>🎉</div>
      <h2 className="text-lg font-semibold text-ink-50">Your first agent is live and just ran.</h2>
      <p className="text-sm text-ink-300 mt-1 leading-relaxed">
        That&apos;s the whole loop: describe it, it runs in your own Claude, the result comes home. Most people stop doing one more thing by hand right here, want a second?
      </p>
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button type="button" onClick={buildNext} className="btn-success text-sm px-4 py-2">
          {nextTitle ? `Build “${nextTitle}” next` : 'Build another agent'}
        </button>
        <button type="button" onClick={close} className="text-sm text-ink-400 hover:text-ink-200">
          Maybe later
        </button>
      </div>
    </section>
  );
}
