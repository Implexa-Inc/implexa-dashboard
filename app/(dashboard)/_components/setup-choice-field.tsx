'use client';

/**
 * <SetupChoiceField /> — THE one control for a `kind: 'choice'` setup answer.
 *
 * THE BUG IT FIXES (founder, 2026-07-24): "Run Settings in Setup has an Other
 * option which I selected, but this dialog just before Run doesn't — and it
 * overrides it."
 *
 * Two surfaces rendered the same question with different capabilities:
 *   • the Setup card offered "Other (type your own)…" + a free-text input, so a
 *     custom answer ("keep the pacing, only cut what's unusable") could be saved;
 *   • the pre-Run dialog rendered ONLY the canned options.
 *
 * That is not merely a missing option — it is DATA LOSS. A saved custom answer
 * matches no <option>, so the pre-Run select shows blank/first-item, and on Run
 * the dialog POSTs its own setupValues back to /setup — overwriting the user's
 * real answer with a canned one, permanently, without ever showing them the
 * value it replaced. The user's careful instruction is silently swapped for its
 * opposite.
 *
 * So the control lives in ONE place and both surfaces mount it. (Same lesson as
 * the drain kind-list vs prompt divergence: two copies of one contract drift,
 * and the drift is invisible until it costs someone real work.)
 *
 * A saved value that is not among the options is, by definition, an Other
 * answer — so the field OPENS in Other mode showing that text, rather than
 * discarding it.
 */

import { useState } from 'react';

const OTHER = '__other__';

export default function SetupChoiceField({
  value, options, onChange, selectClassName = '', inputClassName = '', ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
  selectClassName?: string;
  inputClassName?: string;
  ariaLabel?: string;
}) {
  // A non-empty value that is not one of the offered options IS a custom answer.
  // Deriving this (rather than trusting a flag) is what makes a saved Other
  // answer survive a remount in a different surface.
  const derivedOther = !!value && !options.includes(value);
  const [manualOther, setManualOther] = useState(false);
  const isOther = manualOther || derivedOther;

  return (
    <div className="space-y-2">
      <select
        aria-label={ariaLabel}
        value={isOther ? OTHER : (value ?? '')}
        onChange={(e) => {
          const val = e.target.value;
          if (val === OTHER) {
            setManualOther(true);
            // Keep an existing custom answer when re-entering Other; only clear
            // when switching in from a canned option (nothing to preserve).
            if (!derivedOther) onChange('');
            return;
          }
          setManualOther(false);
          onChange(val);
        }}
        className={selectClassName}
      >
        <option value="">Choose…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER}>Other (type your own)…</option>
      </select>
      {isOther && (
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer"
          className={inputClassName}
        />
      )}
    </div>
  );
}
