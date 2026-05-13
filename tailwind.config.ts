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
 * `brand` (warm orange), `accent` (golden yellow), `success` (emerald) are
 * saturated mid-tones that work in both modes — no flip needed.
 *
 * Color semantics:
 *   🟠 brand    → ACTION   (CTAs, primary buttons, clickable accents)
 *   🟡 accent   → ATTENTION (pending, warnings, drafts, highlights)
 *   🌿 success  → OUTCOMES  (attributed value, ✓ confirmations, active state, ROI)
 */

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  darkMode: 'media',
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
          50:  '#FFF1E5',
          100: '#FFE0C7',
          200: '#FFC4A0',
          300: '#FFA876',
          400: '#FFB57E',
          500: '#FF8A3C',                                                              // PRIMARY — warm orange CTA
          600: '#D9663D',
          700: '#A04A28',
          800: '#5A2E13',
          900: '#3A1E0B',
        },
        accent: {
          50:  '#FFFAE5',
          100: '#FFF3BF',
          200: '#FFE989',
          300: '#FFE05B',
          400: '#FFD93D',                                                              // golden yellow — attention
          500: '#F0C419',
          600: '#D9B82E',
          700: '#A88A23',
          800: '#6B5816',
          900: '#3D310C',
        },
        success: {
          50:  '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',                                                              // PRIMARY — emerald (outcomes/success)
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          800: '#065F46',
          900: '#064E3B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Menlo', 'Monaco', 'monospace'],
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
        glow:           '0 0 24px rgba(255, 138, 60, 0.25)',
        'glow-strong':  '0 0 36px rgba(255, 138, 60, 0.4)',
        'glow-emerald': '0 0 24px rgba(52, 211, 153, 0.25)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;
