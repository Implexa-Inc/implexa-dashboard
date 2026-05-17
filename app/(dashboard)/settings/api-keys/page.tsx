/**
 * /settings/api-keys — "Connected installs" view.
 *
 * Reframed from raw API-key management to a device-audit lens: each row
 * is an install (your laptop, your team's CI machine, an old laptop you
 * sold) tied to a key minted automatically when you ran the install. The
 * primary user action here is to revoke installs you don't recognize.
 *
 * Manual key creation still works but lives in a collapsed Advanced
 * section — users who need a raw key for the Chat Connector URL (the
 * one surface that exposes it) can still generate one. New users via
 * the universal curl never need to touch this page.
 *
 * Route still lives at /settings/api-keys for backwards compatibility
 * with bookmarks, deep links, and the `?next=/install` flow.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import ApiKeysManager from './manager';

export const dynamic = 'force-dynamic';

// Whitelist `next` redirect targets so we don't open-redirect.
function sanitizeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  return next;
}

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  let keys: any[] = [];
  try {
    const r = await callBackend('/api/v2/api-keys', { jwt: session.access_token });
    keys = r.keys || [];
  } catch (_) {}

  const next = sanitizeNext(searchParams?.next);
  const cameFromInstall = next === '/install';

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <nav className="text-xs text-ink-500 mb-4">
          {cameFromInstall ? (
            <Link href="/install" className="hover:underline">← Back to install</Link>
          ) : (
            <Link href="/settings" className="hover:underline">← Settings</Link>
          )}
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Connected installs</h1>
          <p className="text-ink-300 text-sm mt-2 leading-relaxed">
            Every device or session connected to your Implexa account.
            Revoke any you don&apos;t recognize. New installs created automatically
            when you run the install script — you don&apos;t need to generate
            keys manually anymore.
          </p>
        </header>

        {cameFromInstall && (
          <div className="card !p-3 !bg-gradient-to-r !from-brand-500/10 !to-brand-500/5 !border-brand-500/40 mb-6 text-sm text-ink-200 flex items-start gap-2">
            <span>🪜</span>
            <span>
              You probably don&apos;t need to be here. Go back to{' '}
              <Link href="/install" className="text-brand-500 hover:underline">/install</Link>{' '}
              and paste the one-line install command — it auto-creates a key for you.
              This page is for revoking old installs or generating keys manually (advanced).
            </span>
          </div>
        )}

        <ApiKeysManager jwt={session.access_token} initial={keys} next={next} />
      </div>
    </main>
  );
}
