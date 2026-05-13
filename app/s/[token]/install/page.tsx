/**
 * /s/[token]/install — bounce-back target for users who signed up FROM a
 * share-preview page. Auto-fires the install and redirects to /skills with
 * a success flash. If not auth'd (shouldn't happen given the flow), bounce
 * back to the preview.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function InstallBounceback({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect(`/login?next=/s/${encodeURIComponent(params.token)}/install`);

  // Ensure the user has completed onboarding (has a users row with organization_id)
  const { data: profile } = await supabase
    .from('users').select('organization_id').eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) {
    redirect(`/onboarding?next=/s/${encodeURIComponent(params.token)}/install`);
  }

  try {
    await callBackend(`/api/v2/share/${encodeURIComponent(params.token)}/install`, {
      jwt:    session.access_token,
      method: 'POST',
    });
    redirect(`/skills?installed=${encodeURIComponent(params.token)}`);
  } catch (err: any) {
    // Forbidden (domain mismatch) or other — bounce back to preview with error
    const msg = encodeURIComponent(err.message || 'Install failed');
    redirect(`/s/${encodeURIComponent(params.token)}?install_error=${msg}`);
  }
}
