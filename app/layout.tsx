import './globals.css';
import type { Metadata } from 'next';
import { JetBrains_Mono, Shippori_Mincho, Zen_Kaku_Gothic_New } from 'next/font/google';
import { themeBootScript, themeMode } from '@/lib/theme';
import { WebAnalytics } from '@/components/web-analytics';

// Tukido type system (Implexa/tukido-app-design/DESIGN_SYSTEM.md):
//   UI       → Zen Kaku Gothic New (everything you read and click)
//   Display  → Shippori Mincho (page titles only; see `h1` in globals.css)
//   Mono     → JetBrains Mono (IDs, code, technical details)
// Self-hosted via next/font: no layout shift, no runtime request to Google.
const ui = Zen_Kaku_Gothic_New({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-ui',
  display: 'swap',
});

const display = Shippori_Mincho({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title:       'Tukido — Build and run powerful agents in your own Claude or Codex',
  description: 'Build and run powerful agents inside your own Claude or Codex, on your machine. Unlimited agents. Free forever.',
  manifest: '/site.webmanifest',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = themeMode();
  // Server renders the theme everyone gets by default (dark). The boot script
  // runs before first paint and may switch to light (clock mode by day, or a
  // per-browser `?theme=` preview), so <html> attributes can legitimately
  // differ from the server render: suppressHydrationWarning covers exactly that.
  return (
    <html
      lang="en"
      className={`dark ${ui.variable} ${display.variable} ${jetbrainsMono.variable}`}
      style={{ colorScheme: 'dark' }}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript(mode) }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <WebAnalytics />
      </body>
    </html>
  );
}
