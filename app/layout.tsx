import './globals.css';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

// Inter was named in the Tailwind font stack but never actually loaded, so the
// app silently fell back to system fonts and the Inter-only stylistic sets in
// globals.css did nothing. Self-hosting it via next/font (no layout shift, no
// external request at runtime) is what makes the type read crisp and uniform
// across platforms, the way Vercel's own dashboard does.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title:       'Implexa — Build and run powerful agents in your own Claude or Codex',
  description: 'Build and run powerful agents inside your own Claude or Codex, on your machine. Unlimited agents. Free forever.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/logo-mark.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `dark` is forced here so every user gets the good dark theme regardless
    // of OS preference. `color-scheme: dark` keeps native controls (scrollbars,
    // form widgets, the browser chrome) consistent with the app.
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`} style={{ colorScheme: 'dark' }}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
