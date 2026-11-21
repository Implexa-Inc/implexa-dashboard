import PageHeader from '@/components/page-header';
/**
 * /settings/local-vault — the Local key vault management surface.
 *
 * A NEW route, deliberately NOT an evolution of /settings/api-keys: that page
 * is "Connected installs" (Implexa's own imp_live_… device keys — a different
 * concern entirely). This page manages PROVIDER keys (Runway, ElevenLabs, …)
 * that live encrypted on the user's Mac.
 *
 * TRUST BOUNDARY (LOCAL_KEY_VAULT_SPEC): every saved/granted fact on this page
 * comes from the LOCAL desktop bridge — masked metadata only, never a value.
 * The backend contributes only catalog facts (which agents may need which key,
 * display names) via /api/v2/me/vault-context. Key values never reach this
 * page, its JS, the backend, or anyone's prompts. Adding/replacing/allowing a
 * key opens the desktop's own native window; revoking/deleting is decided in a
 * native dialog the page cannot render or click.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import VaultManager from './vault-manager';

export const dynamic = 'force-dynamic';

export default async function LocalVaultPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  return (
    <section className="settings-page">
      <div className="settings-page-content">

        <PageHeader title="Local key vault">
          {/* Trust-true for v1: a granted agent process CAN use the key locally.
              Never claim agents structurally cannot see keys — that is the v2
              capability proxy, which does not exist yet. */}
          <p className="app-page-description">
            Your keys are encrypted on this Mac. Tukido doesn&apos;t upload them.
            Agents you approve can use them locally to call the provider.
          </p>
        </PageHeader>

        <VaultManager jwt={session.access_token} />
      </div>
    </section>
  );
}

export const metadata = {
  title: 'Local key vault — Tukido',
};
