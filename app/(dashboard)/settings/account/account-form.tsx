'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function AccountForm({
  currentEmail,
  currentDisplayName,
}: {
  currentEmail: string;
  currentDisplayName: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  // Display name
  const [name, setName] = useState(currentDisplayName);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameDone, setNameDone] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Email
  const [newEmail, setNewEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null); setNameSaving(true); setNameDone(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setNameError('Session lost — sign in again.'); setNameSaving(false); return; }

    const { error } = await supabase
      .from('users').update({ display_name: name.trim() }).eq('id', user.id);

    setNameSaving(false);
    if (error) setNameError(error.message);
    else {
      setNameDone(true);
      setTimeout(() => setNameDone(false), 2000);
      router.refresh();
    }
  }

  async function requestEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null); setEmailSaving(true);

    const { error } = await supabase.auth.updateUser(
      { email: newEmail.trim() },
      {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings/account`,
      },
    );

    setEmailSaving(false);
    if (error) setEmailError(error.message);
    else setEmailSent(true);
  }

  return (
    <div className="space-y-6">
      {/* Display name */}
      <section className="card">
        <h2 className="text-base font-medium text-ink-50 mb-1">Display name</h2>
        <p className="text-xs text-ink-300 mb-4">
          Shown on shared skills and to teammates in your org.
        </p>
        <form onSubmit={saveName} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={nameSaving}
            className="input flex-1"
            maxLength={120}
          />
          <button
            type="submit"
            disabled={nameSaving || name.trim() === currentDisplayName.trim()}
            className="btn-primary whitespace-nowrap"
          >
            {nameSaving ? 'Saving…' : nameDone ? '✓ Saved' : 'Save name'}
          </button>
        </form>
        {nameError && <p className="text-xs text-red-600 mt-2">{nameError}</p>}
      </section>

      {/* Email */}
      <section className="card">
        <h2 className="text-base font-medium text-ink-50 mb-1">Email address</h2>
        <p className="text-xs text-ink-300 mb-3">
          Current: <code className="text-xs bg-ink-800 px-1.5 py-0.5 rounded font-mono">{currentEmail}</code>
        </p>
        <p className="text-xs text-ink-400 mb-4 leading-relaxed">
          Changing your email sends a confirmation link to the <em>new</em> address. Your email won&apos;t update until you click that link. Until confirmed, sign in with your current address.
        </p>

        {emailSent ? (
          <div className="text-sm text-success-700 dark:text-success-400">
            ✓ Confirmation email sent to <strong>{newEmail}</strong>. Click the link in that email to complete the change.
          </div>
        ) : (
          <form onSubmit={requestEmailChange} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <input
              type="email"
              required
              placeholder="new-email@yourdomain.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              disabled={emailSaving}
              className="input flex-1"
            />
            <button
              type="submit"
              disabled={emailSaving || !newEmail.trim() || newEmail.trim() === currentEmail}
              className="btn-primary whitespace-nowrap"
            >
              {emailSaving ? 'Sending…' : 'Send confirmation'}
            </button>
          </form>
        )}
        {emailError && <p className="text-xs text-red-600 mt-2">{emailError}</p>}
      </section>

      {/* Account deletion — punt to support */}
      <section className="card !border-red-500/20">
        <h2 className="text-base font-medium text-ink-50 mb-1">Delete your account</h2>
        <p className="text-xs text-ink-300 mb-3 leading-relaxed">
          Account deletion is currently white-glove — email us and we&apos;ll handle it within 1 business day.
          You can also export your captured skills first via your dashboard.
        </p>
        <a href={`mailto:support@implexa.ai?subject=${encodeURIComponent('Delete my Implexa account')}&body=${encodeURIComponent(`Please delete my account: ${currentEmail}`)}`}
           className="text-xs text-red-600 hover:underline">
          Email support to delete →
        </a>
      </section>
    </div>
  );
}
