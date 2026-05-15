/**
 * Implexa logo component — wordmark + mark variants.
 *
 * Brand source: founder-provided SVG assets (May 2026 refresh).
 *   - implexa-favicon.svg       → square mark, dark-bg with emerald-glow tittle
 *   - implexa-logo-light.svg    → wordmark for LIGHT backgrounds (black text)
 *   - implexa-logo.svg          → wordmark for DARK backgrounds (off-white text)
 *
 * Implementation notes:
 *   - The SVGs are inlined as JSX (NOT loaded via <img src=…/>) so the
 *     <text> element renders against the document's loaded Inter font.
 *     Loading the SVG via <img> isolates it from the page's font context
 *     and the wordmark would render in a fallback font (positions of the
 *     emerald i-dot and flame x-dot would drift).
 *   - Both wordmark color variants share the same geometry — the brand
 *     dots are at fixed coordinates that match Inter Bold-700's glyph
 *     layout. The only thing that changes between dark/light is the
 *     text fill color.
 *   - <Logo> takes an optional `theme` prop (default 'dark') for callers
 *     that render on light surfaces.
 */

/** Horizontal Implexa wordmark — "implexa" with emerald i-dot + flame x-dot. */
export function Logo({
  className = '',
  height   = 24,
  theme    = 'dark',
}: {
  className?: string;
  /** Pixel height of the wordmark. Width follows from the 600:160 viewBox ratio. */
  height?:    number;
  /** Background tone of the surrounding surface. `dark` → off-white text. `light` → near-black text. */
  theme?:     'dark' | 'light';
}) {
  const width     = height * (600 / 160);
  const textColor = theme === 'dark' ? '#fafafa' : '#0a0a0a';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 600 160"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="Implexa"
    >
      {/* dotless i (U+0131) so we can place the emerald tittle ourselves */}
      <text
        x={40}
        y={125}
        fill={textColor}
        style={{
          fontFamily:    "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
          fontWeight:    700,
          fontSize:      '120px',
          letterSpacing: '-4px',
        }}
      >
        ımplexa
      </text>
      {/* emerald tittle above the i */}
      <circle cx={54}  cy={40} r={11} fill="#34d399" />
      {/* flame node centered on the x */}
      <circle cx={350} cy={92} r={11} fill="#ff8a3c" />
    </svg>
  );
}

/**
 * Square Implexa mark — favicon shape, also used as the app-icon glyph
 * in the dashboard sidebar header. Self-contained dark surface (works
 * on any background) with the emerald-glow i-tittle as the signature.
 */
export function LogoMark({ className = '', size = 32 }: { className?: string; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Implexa"
    >
      <rect width={64} height={64} rx={12} fill="#0a0a0a" />
      {/* stem of 'i' */}
      <rect x={26} y={24} width={12} height={28} rx={2} fill="#fafafa" />
      {/* emerald tittle (solid + blurred halo for the glow signature) */}
      <circle cx={32} cy={15} r={6} fill="#34d399" />
      <circle cx={32} cy={15} r={6} fill="#34d399" opacity={0.35} style={{ filter: 'blur(2px)' }} />
    </svg>
  );
}
