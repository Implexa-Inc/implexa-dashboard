/**
 * Implexa logo component — wordmark and mark variants.
 *
 * Brand source: /Users/rabigupta/Downloads/implexa-brand/BRAND.md
 *
 * Design decisions:
 * - Wordmark uses HTML/CSS (not SVG <text>) so the browser handles text
 *   layout natively. Hardcoded x-coords in SVG <text> break before the
 *   custom font loads — characters land at fallback-font positions and
 *   the wordmark renders with visible gaps ("i mple x a"). Using HTML
 *   means the dots stay relative to their parent characters regardless
 *   of font loading state.
 * - Text uses currentColor so the wordmark adapts to surrounding text
 *   color (works on both dark and light backgrounds).
 * - The two signature dots are hardcoded brand accents:
 *     i-dot = emerald #34D399 (signal/active — pulses subtly)
 *     x-dot = vermilion #FF5722 (action/energy — matches dashboard brand-500)
 */

/** Horizontal Implexa wordmark — "implexa" with emerald dot on i, flame dot on x. */
export function Logo({ className = '', height = 24 }: { className?: string; height?: number }) {
  // Dot diameter scales with font height so the proportions stay correct
  // at any size from a tiny 16px header to a 64px hero. ~20% of the cap
  // height matches the SVG version's `r=7` at fontSize=64.
  const dot = Math.max(4, Math.round(height * 0.2));

  return (
    <span
      className={`inline-flex items-baseline font-semibold tracking-tight leading-none select-none ${className}`}
      style={{ fontSize: height, letterSpacing: '-0.03em' }}
      role="img"
      aria-label="Implexa"
    >
      {/* Dotless i + emerald accent dot above */}
      <span className="relative inline-block">
        {/* U+0131 "LATIN SMALL LETTER DOTLESS I" — keeps the glyph width
         * the same as a regular i so spacing stays correct. */}
        {'ı'}
        <span
          aria-hidden="true"
          className="absolute rounded-full animate-implexa-pulse"
          style={{
            width: dot,
            height: dot,
            backgroundColor: '#34D399',
            top: `-${dot * 0.15}px`,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        />
      </span>
      <span>mple</span>
      {/* x + vermilion accent dot at the bottom-right of the x */}
      <span className="relative inline-block">
        x
        <span
          aria-hidden="true"
          className="absolute rounded-full"
          style={{
            width: dot,
            height: dot,
            backgroundColor: '#FF5722',
            bottom: `-${dot * 0.1}px`,
            right: `-${dot * 0.25}px`,
          }}
        />
      </span>
      <span>a</span>
    </span>
  );
}

/** Square Implexa mark — used for app icons, social avatars, anywhere a badge is needed. */
export function LogoMark({ className = '', size = 32 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Implexa"
    >
      <rect width={128} height={128} rx={28} fill="#0A0805" />
      <rect x={0.5} y={0.5} width={127} height={127} rx={27.5} fill="none" stroke="#2A241E" />
      <path d="M36 36 L36 76 L92 76" fill="none" stroke="#10B981" strokeWidth={3} strokeLinecap="round" opacity={0.55} />
      <path d="M92 36 L92 92" fill="none" stroke="#FF5722" strokeWidth={3} strokeLinecap="round" opacity={0.55} />
      <circle cx={36} cy={36} r={8} fill="#34D399" />
      <circle cx={36} cy={36} r={14} fill="none" stroke="#10B981" strokeWidth={1} opacity={0.4} />
      <circle cx={92} cy={92} r={8} fill="#FF5722" />
      <circle cx={92} cy={92} r={14} fill="none" stroke="#FF5722" strokeWidth={1} opacity={0.4} />
      <circle cx={92} cy={76} r={2.5} fill="#F5F0E8" opacity={0.5} />
      <circle cx={36} cy={76} r={2.5} fill="#F5F0E8" opacity={0.5} />
    </svg>
  );
}
