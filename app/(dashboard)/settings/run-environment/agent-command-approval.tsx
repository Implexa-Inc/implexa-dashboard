'use client';

import { useEffect, useState } from 'react';
import { commandApprovalAccountMatches, saveAgentCommandApproval } from '@/lib/agent-command-approval';
import { createClient } from '@/lib/supabase/client';

export default function AgentCommandApproval({ initialGranted, accountId }: {
  initialGranted: boolean | null;
  accountId: string;
}) {
  const [granted, setGranted] = useState(initialGranted);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [accountMatches, setAccountMatches] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    const check = () => void commandApprovalAccountMatches(accountId)
      .then(matches => { if (current) setAccountMatches(matches); })
      .catch(() => { if (current) setAccountMatches(false); });
    check();
    window.addEventListener('focus', check);
    return () => { current = false; window.removeEventListener('focus', check); };
  }, [accountId]);

  async function changeApproval() {
    if (granted === null || saving || accountMatches !== true) return;
    const next = !granted;
    setSaving(true);
    setMessage('');
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session || session.user.id !== accountId) throw Error('The account changed. Reload Settings.');
      await saveAgentCommandApproval(accountId, next, session.access_token);
      setGranted(next);
      setMessage(next ? 'Command permission is on for your account.' : 'Command permission is off for your account.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save command permission. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="agent-commands" aria-labelledby="agent-command-title" className="card mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-command-title" className="font-medium text-ink-50">Run commands on your computer</h2>
          <p className="mt-1 text-ink-400">
            Allow your Tukido agents to run commands on your linked computers when their work needs them.
            Changes apply to runs claimed after you save. Manage individual approvals in Agent Setup.
          </p>
        </div>
        {accountMatches === false ? <p role="status" className="text-state-needs">Use the same Tukido account in Desktop and Dashboard, or open Settings in your browser.</p>
          : granted === null ? <p role="status" className="text-state-needs">Could not check permission. Refresh to try again.</p> :
          <button className="btn btn-sm btn-secondary" type="button" disabled={saving || accountMatches !== true} onClick={changeApproval}>
            {saving ? 'Saving…' : granted ? 'Turn off for my account' : 'Allow commands for my agents'}
          </button>}
      </div>
      <p role="status" className="text-secondary mt-2">{message}</p>
    </section>
  );
}
