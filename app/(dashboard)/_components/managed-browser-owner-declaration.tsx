'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { confirmOwnerDecision, loadOwnerView, ownerDecision, type OwnerTarget, type OwnerView } from '@/lib/managed-browser-owner-declaration';
import { useDesktopBridge } from './api-key-row';
import Modal from './modal';

// A declaration is an owner statement, not account verification, browser
// qualification or approval to start a trial. No reads prepare a browser until
// the owner explicitly opens this form; revocation has its own browser-free read.
export default function ManagedBrowserOwnerDeclaration({ target }: { target: OwnerTarget }) {
  const bridge = useDesktopBridge();
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<OwnerView | null>(null);
  const [operation, setOperation] = useState<'declare' | 'revoke'>('declare');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [expires, setExpires] = useState('');
  const [evidence, setEvidence] = useState('');
  const [message, setMessage] = useState('');
  const key = JSON.stringify(target);
  const scope = useRef({ key, generation: 0, authEpoch: 0, mounted: true, writing: false });
  scope.current.key = key;

  useEffect(() => {
    scope.current.mounted = true;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT' && event !== 'SIGNED_IN' && event !== 'USER_UPDATED') return;
      scope.current.authEpoch++; scope.current.generation++;
      setView(null); setOpen(false); setMessage(''); setBusy(false);
    });
    return () => { scope.current.mounted = false; scope.current.generation++; data.subscription.unsubscribe(); };
  }, [supabase]);
  useEffect(() => {
    scope.current.generation++;
    setView(null); setOpen(false); setMessage(''); setBusy(false); setConfirmed(false); setExpires(''); setEvidence('');
  }, [key]);

  const supported = !!bridge?.managedBrowserNoSpendContext && !!bridge?.confirmManagedBrowserNoSpend;
  function context() {
    const generation = ++scope.current.generation, authEpoch = scope.current.authEpoch, targetKey = key;
    return { target: { ...target }, bridge: bridge || {}, getSession: async () => (await supabase.auth.getSession()).data.session,
      current: () => scope.current.mounted && scope.current.key === targetKey && scope.current.generation === generation && scope.current.authEpoch === authEpoch };
  }
  async function review(next: 'declare' | 'revoke') {
    if (scope.current.writing || busy || !supported) return;
    const ctx = context();
    setBusy(true); setMessage(''); setView(null); setConfirmed(false); setExpires(''); setEvidence('');
    try {
      const result = await loadOwnerView(ctx, next);
      if (!ctx.current()) return;
      setView(result); setOperation(next); setOpen(true);
    } catch (error) {
      if (ctx.current()) setMessage(error instanceof Error ? error.message : 'Account statement unavailable. Review it again.');
    } finally { if (ctx.current()) setBusy(false); }
  }
  async function submit() {
    if (!view || busy || scope.current.writing || !confirmed) return;
    let decision;
    try {
      const expiresAt = expires && Number.isFinite(Date.parse(expires)) ? new Date(expires).toISOString() : '';
      decision = ownerDecision(view, operation, { confirmed, expiresAt, evidenceRef: evidence });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Check your choices.'); return; }
    const ctx = context();
    scope.current.writing = true; setBusy(true); setMessage('');
    try {
      await confirmOwnerDecision(ctx, decision);
      if (!ctx.current()) return;
      setOpen(false); setView(null);
      setMessage(operation === 'declare' ? 'Statement saved — owner-declared, unverified.' : 'Statement revoked.');
    } catch {
      if (ctx.current()) {
        setOpen(false); setView(null);
        setMessage('The result could not be confirmed. Review the current statement before trying again.');
      }
    } finally { scope.current.writing = false; if (ctx.current()) setBusy(false); }
  }
  const close = () => { if (!busy) { scope.current.generation++; setOpen(false); setView(null); setMessage(''); } };

  return <div className="mt-3 rounded-lg border border-ink-800 p-3" data-managed-browser-owner-statement>
    <p className="text-sm font-medium text-ink-100">Browser account statement</p>
    <p className="mt-1 text-xs text-ink-400">Confirm a free account with no payment method for this Agent’s browser workspace.</p>
    {supported ? <div className="mt-2 flex flex-wrap gap-3">
      <button type="button" className="btn-outline text-xs px-2.5 py-1" disabled={busy} onClick={() => void review('declare')}>Review statement</button>
      <button type="button" className="text-xs text-ink-400 underline" disabled={busy} onClick={() => void review('revoke')}>Revoke saved statement</button>
    </div> : <p className="mt-2 text-xs text-ink-400">Open this Agent in an updated Implexa app to manage its statement.</p>}
    {message && <p role="status" className="mt-2 text-xs text-ink-300">{message}</p>}
    <Modal open={open} onClose={close} title={operation === 'declare' ? 'Confirm account statement' : 'Revoke account statement'}>
      {view && <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-4">
        <p className="text-sm text-ink-300">Applies to {view.origins.join(', ')} in this Agent’s browser workspace.</p>
        <p className="text-xs text-ink-400">{view.state === 'absent' ? 'No saved statement.' : view.state === 'mismatch' ? 'Clock or account state mismatch. Revoke the saved statement or review setup.' : `${view.state === 'expired' ? 'Expired' : 'Owner-declared, unverified'} · ${view.declaration ? new Date(view.declaration.expiresAt).toLocaleString() : ''}`}</p>
        {operation === 'declare' ? <>
          <label className="block text-sm text-ink-200"><input type="checkbox" checked={confirmed} disabled={busy || view.state === 'mismatch'} onChange={(event) => setConfirmed(event.target.checked)} className="mr-2" />I confirm these accounts use a free plan and have no payment method.</label>
          <label className="block text-sm text-ink-300">Expires at (your local time)<input type="datetime-local" required value={expires} onChange={(event) => setExpires(event.target.value)} disabled={busy} className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2" /></label>
          <p className="text-xs text-ink-400">Choose a future time within 30 days. This statement is unverified and grants no permission to spend.</p>
          <label className="block text-sm text-ink-300">Evidence reference (optional)<input type="text" maxLength={1024} value={evidence} onChange={(event) => setEvidence(event.target.value)} disabled={busy} className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2" /></label>
        </> : <label className="block text-sm text-ink-200"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} className="mr-2" />Revoke this saved statement. Future browser actions requiring it will stop.</label>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={close} disabled={busy} className="btn-outline text-sm">Cancel</button>
          <button type="submit" disabled={busy || !confirmed || operation === 'declare' && (!expires || view.state === 'mismatch')} className="btn-primary text-sm">{busy ? 'Confirming…' : operation === 'declare' ? 'Confirm statement' : 'Revoke statement'}</button>
        </div>
      </form>}
    </Modal>
  </div>;
}
