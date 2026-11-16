import type { Config } from 'tailwindcss';

/**
 * Implexa dashboard — day/night palette driven by CSS variables.
 *
 * The `ink` scale FLIPS based on `prefers-color-scheme`:
 *   - In light mode: ink-50 is darkest (primary text), ink-950 is white (body bg)
 *   - In dark mode:  ink-50 is brightest (primary text), ink-950 is near-black (body bg)
 *
 * Semantic intent stays the same across modes:
 *   ink-50   → primary text (best contrast)
 *   ink-100  → body text
 *   ink-200  → emphasized body
 *   ink-300  → muted text
 *   ink-400  → captions
 *   ink-500  → subtle UI text
 *   ink-600  → prominent borders
 *   ink-700  → subtle dividers
 *   ink-800  → hover surfaces
 *   ink-900  → card / surface
 *   ink-950  → body bg
 *
 * `brand` (shu vermilion), `accent` (ochre), `success` (matcha) come from the
 * Tukido design system (Implexa/tukido-app-design). They don't flip.
 *
 * Color semantics:
 *   🟠 brand    → ACTION   (CTAs, primary buttons, clickable accents)
 *   🟡 accent   → ATTENTION (pending, warnings, drafts, highlights)
 *   🌿 success  → OUTCOMES  (attributed value, ✓ confirmations, active state, ROI)
 */

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  // Class-based dark mode. app/layout.tsx decides who gets the `dark` class
  // (THEME_MODE: everyone, or by local clock 7pm–6am) before first paint.
  // Light mode is reachable only when that class is absent (e.g. a future
  // theme toggle); the `:root` tokens below keep it professional for that case.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          50:  'rgb(var(--ink-50) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          950: 'rgb(var(--ink-950) / <alpha-value>)',
        },
        brand: {
          50:   '#FDEEEB',
          100:  '#F9D5CE',
          200:  '#F2AB9E',
          300:  '#EC806E',
          400:  '#E0563F',  // brighter vermilion for links/accents on dark
          500:  '#C8321F',  // PRIMARY: shu vermilion (Tukido). White label = 5.2:1.
          600:  '#A92918',
          700:  '#862013',
          800:  '#5F170D',
          900:  '#3A0E08',
        },
        accent: {
          50:   '#FDF6E3',
          100:  '#F9E8BD',
          200:  '#F2D27F',
          300:  '#EBBD4F',
          400:  '#E0A630',
          500:  '#C98A12',  // ATTENTION: ochre (Needs you)
          600:  '#A5700C',
          700:  '#80540A',  // ochre text on light paper (5.4:1)
          800:  '#5A3B08',
          900:  '#352305',
        },
        success: {
          50:   '#EDF5EE',
          100:  '#D4E8D7',
          200:  '#A9D1B0',
          300:  '#86C99A',
          400:  '#5FAE78',  // OUTCOMES: matcha green
          500:  '#46925E',
          600:  '#3F7A4D',
          700:  '#2F5D3A',  // matcha text on light paper
          800:  '#22442A',
          900:  '#15291A',
        },
      },
      fontFamily: {
        sans:    ['var(--font-ui)', 'Zen Kaku Gothic New', 'Hiragino Sans', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-display)', 'Shippori Mincho', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'Menlo', 'Monaco', 'monospace'],
      },
      typography: ({ theme }: any) => ({
        DEFAULT: {
          css: {
            color:                         'rgb(var(--ink-100))',
            '--tw-prose-body':             'rgb(var(--ink-100))',
            '--tw-prose-headings':         'rgb(var(--ink-50))',
            '--tw-prose-lead':             'rgb(var(--ink-200))',
            '--tw-prose-links':            theme('colors.brand.500'),
            '--tw-prose-bold':             'rgb(var(--ink-50))',
            '--tw-prose-counters':         'rgb(var(--ink-400))',
            '--tw-prose-bullets':          'rgb(var(--ink-600))',
            '--tw-prose-hr':               'rgb(var(--ink-700))',
            '--tw-prose-quotes':           'rgb(var(--ink-200))',
            '--tw-prose-quote-borders':    theme('colors.brand.500'),
            '--tw-prose-captions':         'rgb(var(--ink-400))',
            '--tw-prose-code':             theme('colors.success.600'),
            '--tw-prose-pre-code':         'rgb(var(--ink-100))',
            '--tw-prose-pre-bg':           'rgb(var(--ink-950))',
            '--tw-prose-th-borders':       'rgb(var(--ink-700))',
            '--tw-prose-td-borders':       'rgb(var(--ink-800))',
            code: {
              backgroundColor: 'rgb(var(--ink-800))',
              padding:         '0.15rem 0.4rem',
              borderRadius:    '0.25rem',
              fontWeight:      '500',
            },
            'code::before': { content: '""' },
            'code::after':  { content: '""' },
            pre: {
              backgroundColor: 'rgb(var(--ink-950))',
              border:          `1px solid rgb(var(--ink-700))`,
            },
          },
        },
      }),
      boxShadow: {
        glow:           '0 0 24px rgba(200, 50, 31, 0.22)',
        'glow-strong':  '0 0 36px rgba(200, 50, 31, 0.35)',
        'glow-emerald': '0 0 24px rgba(95, 174, 120, 0.25)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;
