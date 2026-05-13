import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title:       'Implexa — Skill recording for any AI session',
  description: 'Demonstrate any workflow once. Implexa captures it as a reusable, structured, measurable skill.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
