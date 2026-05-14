/**
 * Implexa logo component — wordmark and mark variants.
 *
 * Brand source: /Users/rabigupta/Downloads/implexa-brand/BRAND.md
 *
 * Design decisions:
 * - Text fills with currentColor so the wordmark adapts to surrounding text
 *   color (ink-50 in dark mode, ink-50 in light mode — both readable on
 *   their respective backgrounds).
 * - The two signature dots are hardcoded brand accents:
 *     i-dot = emerald #34D399 (signal/active — pulses subtly)
 *     x-dot = vermilion #FF5722 (action/energy — matches dashboard brand-500)
 * - Inline SVG (not <img>) so we get currentColor + animation without
 *   any extra HTTP requests on first paint.
 */

/** Horizontal Implexa wordmark — "implexa" with emerald dot on i, flame dot on x. */
export function Logo({ className = '', height = 24 }: { className?: string; height?: number }) {
  // viewBox 480x120 → use natural aspect ratio to derive width
  const width = height * (480 / 120);
  return (
    <svg
      viewBox="0 0 480 120"
      width={width}
      height={height}
      className={className}
      fill="currentColor"
      role="img"
      aria-label="Implexa"
    >
      <g fontFamily="Inter, system-ui, sans-serif" fontWeight={600} fontSize={64} letterSpacing="-2">
        <text x={40} y={80}>ı</text>
        <circle cx={55} cy={34} r={7} fill="#34D399">
          <animate attributeName="opacity" values="1;.6;1" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <text x={68} y={80}>mple</text>
        <text x={220} y={80}>x</text>
        <circle cx={241} cy={62} r={7} fill="#FF5722" />
        <text x={258} y={80}>a</text>
      </g>
    </svg>
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
