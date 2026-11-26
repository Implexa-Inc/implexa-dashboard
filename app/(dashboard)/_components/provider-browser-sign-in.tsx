'use client';

import { useState } from 'react';
import { useDesktopBridge } from './api-key-row';

export function requiresProviderEmail(domain: string) {
  return /^(?:(?:[^.]+\.)*runwayml\.com|chatgpt\.com)$/i.test(domain);
}

export function ProviderBrowserSignIn({ domain, onVerified, onConfirmationChanged }: {
  domain: string;
  onVerified?: () => void | Promise<void>;
  onConfirmationChanged?: (confirmed: boolean) => void;
}) {
  const bridge = useDesktopBridge();
  const matchEmail = requiresProviderEmail(domain);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'signin' | 'verify' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const buttonClass = 'btn-outline text-ui px-2.5 py-1';

  async function signIn() {
    if (!bridge?.connectAccount || busy) return;
    setConfirmed(false);
    onConfirmationChanged?.(false);
    setBusy('signin');
    setNote(null);
    try {
      const result = await bridge.connectAccount(domain);
      if (!result.ok) {
        setNote(result.message || 'Could not open the provider sign-in tab.');
        return;
      }
      setNote(result.message || 'Finish signing in in the provider tab, then select Verify.');
    } catch {
      setNote('Could not open the provider sign-in tab.');
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    if (!bridge?.verifyAccount || busy) return;
    const expected = email.trim().toLowerCase();
    if (matchEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expected)) {
      setNote('Enter the email address of the provider account you want to use.');
      return;
    }
    setBusy('verify');
    setNote(null);
    setConfirmed(false);
    onConfirmationChanged?.(false);
    try {
      const result = await bridge.verifyAccount(domain, matchEmail ? expected : undefined);
      if (!result.ok || !result.reachable) {
        setNote(result.message || 'Tukido could not confirm the sign-in. Check the provider tab and try again.');
        return;
      }
      // Older Desktop builds ignore the expected email and may still return a
      // positive URL-only result. Only accept the newer matching-account proof.
      if (matchEmail && (result.accountMatched !== true || result.identity?.toLowerCase() !== expected)) {
        setNote('Update Tukido Desktop to verify the provider account.');
        return;
      }
      setConfirmed(true);
      onConfirmationChanged?.(true);
      setNote(matchEmail ? `Connected as ${result.identity}.` : 'Browser access verified.');
      void Promise.resolve().then(() => onVerified?.()).catch(() => {});
    } catch {
      setNote('Tukido could not confirm the sign-in. Try Verify again.');
    } finally {
      setBusy(null);
    }
  }

  if (!bridge?.connectAccount) return null;
  if (matchEmail && bridge.providerBrowserAccountMatching !== true) {
    return <p className="text-secondary text-ink-400">Update Tukido Desktop to verify the provider account.</p>;
  }
  return <div className="min-w-0 space-y-2">
    {matchEmail && <label className="block text-secondary text-ink-400">Provider account email
      <input type="email" value={email} maxLength={254} disabled={busy !== null}
        className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-ink-100"
        onChange={event => { setEmail(event.target.value); setConfirmed(false); onConfirmationChanged?.(false); setNote(null); }} />
    </label>}
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={buttonClass} disabled={busy !== null} onClick={signIn}>
        {busy === 'signin' ? 'Opening…' : 'Sign in'}
      </button>
      <button type="button" className={buttonClass} disabled={!bridge.verifyAccount || busy !== null} onClick={verify}>
        {busy === 'verify' ? 'Checking…' : 'Verify'}
      </button>
    </div>
    {note && <p role="status" className={`text-secondary ${confirmed ? 'text-state-ok' : 'text-ink-400'}`}>{note}</p>}
  </div>;
}
