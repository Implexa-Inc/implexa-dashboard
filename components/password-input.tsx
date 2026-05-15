'use client';

import { useState } from 'react';

/**
 * Password input with a show/hide toggle eye icon on the right.
 *
 * Drop-in replacement for `<input type="password" />` — accepts the same
 * standard HTML input props. Renders the toggle button inside the input
 * via a wrapping <div> with relative positioning.
 *
 * Accessibility: the toggle button is a real <button> with aria-label,
 * and clicking it preserves focus on the input (no jump). The eye icons
 * are inline SVGs so they inherit color and don't depend on any icon
 * font.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Optional className applied to the input itself (NOT the wrapper). */
  className?: string;
};

export default function PasswordInput({ className = '', ...rest }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-400 hover:text-ink-100 transition-colors"
        tabIndex={-1}
      >
        {visible ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

function Eye() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-10-7-10-7a17.4 17.4 0 0 1 3.66-5.06" />
      <path d="M9.9 4.24A10.6 10.6 0 0 1 12 4c7 0 10 7 10 7a17.5 17.5 0 0 1-2.16 3.19" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
