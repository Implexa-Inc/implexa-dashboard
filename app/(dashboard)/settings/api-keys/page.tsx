/**
 * API keys settings — list + create + revoke. Where users get the value
 * they paste into IMPLEXA_API_KEY for the Claude Code plugin.
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
          <h1 className="text-3xl font-semibold tracking-tight">API keys</h1>
          <p className="text-ink-500 text-sm mt-2">
            Generate a key to authenticate the Implexa Claude Code plugin or any MCP client.
            Each key is shown only once at creation — store it securely.
          </p>
        </header>

        {cameFromInstall && (
          <div className="card !p-3 !bg-brand-50 !border-brand-500/30 mb-6 text-sm text-ink-200 flex items-start gap-2">
            <span>🪜</span>
            <span>
              You&apos;re in step 1 of <strong>installing Implexa in Claude</strong>. Create a key below, copy it, then click <strong>← Back to install</strong> to continue.
            </span>
          </div>
        )}

        <ApiKeysManager jwt={session.access_token} initial={keys} next={next} />

        <div className="mt-10 card bg-brand-50 border-brand-500/20">
          <h3 className="font-medium mb-3">Plugin setup</h3>
          <p className="text-sm text-ink-200 mb-3">After creating a key, install the plugin and configure your shell:</p>
          <pre className="text-xs bg-ink-950 text-ink-100 rounded p-3 code-dark overflow-x-auto">{`claude plugin install implexa
echo 'export IMPLEXA_API_KEY="imp_live_..."' >> ~/.zshrc
source ~/.zshrc
claude`}</pre>
        </div>
      </div>
    </main>
  );
}
