'use client';

import { useState } from 'react';
import { useDesktopBridge } from './api-key-row';

export function usesProviderBrowserSession(domain: string) {
  return /^(?:(?:[^.]+\.)*runwayml\.com|chatgpt\.com)$/i.test(domain);
}

export function ProviderBrowserSignIn({ domain, onVerified, onConfirmationChanged }: {
  domain: string;
  onVerified?: () => void | Promise<void>;
  onConfirmationChanged?: (confirmed: boolean) => void;
}) {
  const bridge = useDesktopBridge();
  const sessionCheck = usesProviderBrowserSession(domain);
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
      setNote(sessionCheck ? 'Sign in in the Tukido browser and keep the site signed in while it’s working.'
        : result.message || 'Finish signing in in the provider tab, then select Verify.');
    } catch {
      setNote('Could not open the provider sign-in tab.');
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    if (busy || !bridge) return;
    setBusy('verify');
    setNote(null);
    setConfirmed(false);
    onConfirmationChanged?.(false);
    try {
      if (sessionCheck) {
        const result = await bridge.inspectProviderBrowserSession?.(domain);
        if (!result?.ok || result.sessionConfirmed !== true) {
          setNote(result?.message || 'Tukido could not confirm the browser sign-in.');
          return;
        }
        setNote('Signed-in browser session confirmed.');
      } else {
        const result = await bridge.verifyAccount?.(domain);
        if (!result?.ok || !result.reachable) {
          setNote(result?.message || 'Tukido could not confirm the sign-in. Check the provider tab and try again.');
          return;
        }
        setNote('Browser access verified.');
        void Promise.resolve().then(() => onVerified?.()).catch(() => {});
      }
      setConfirmed(true);
      onConfirmationChanged?.(true);
    } catch {
      setNote('Tukido could not confirm the sign-in. Try again.');
    } finally {
      setBusy(null);
    }
  }

  if (!bridge?.connectAccount) return null;
  const canCheck = sessionCheck ? !!bridge.inspectProviderBrowserSession : !!bridge.verifyAccount;
  return <div className="min-w-0 space-y-2">
    {sessionCheck && !note && <p className="text-secondary text-ink-400">Keep this site signed in while Tukido is working.</p>}
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={buttonClass} disabled={busy !== null} onClick={signIn}>
        {busy === 'signin' ? 'Opening…' : sessionCheck ? 'Open in Tukido browser' : 'Sign in'}
      </button>
      {canCheck && <button type="button" className={buttonClass} disabled={busy !== null} onClick={verify}>
        {busy === 'verify' ? 'Checking…' : sessionCheck ? 'Check sign-in' : 'Verify'}
      </button>}
    </div>
    {note && <p role="status" className={`text-secondary ${confirmed ? 'text-state-ok' : 'text-ink-400'}`}>{note}</p>}
  </div>;
}
