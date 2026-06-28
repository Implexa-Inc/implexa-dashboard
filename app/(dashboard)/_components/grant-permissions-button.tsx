'use client';

/**
 * <GrantPermissionsButton /> — the one-click fix when an agent is caught needing
 * browser / computer-use access it doesn't have on this Mac (the silent-freeze
 * class: an ungranted macOS permission is a blocking dialog, not a tool error).
 *
 * Instead of bouncing the user to onboarding, the button OPENS CLAUDE with a
 * focused, grant-ONLY prompt: Claude calls computer-use request_access (which
 * pops the macOS "Allow Claude to use your computer" dialog) + checks the Chrome
 * extension, then reports the result back via report_runtime_permissions so the
 * setup screen verifies it. It deliberately does NOT run any agent — the single
 * job is to surface the grant prompts while the user is right here to approve.
 *
 * In the desktop app it hands off via window.implexaDesktop.handoffAgent; on the
 * web it falls back to the claude://code/new?q= deep link (same one the desktop
 * uses), so it still opens a fresh Claude Code session with the prompt prefilled.
 */

import { useState } from 'react';

type Bridge = {
  handoffAgent?: (prompt: string, surface?: string, target?: string) => Promise<{ ok: boolean; mode?: string }>;
};

// The grant-only prompt. Mirrors the say-hi STEP B/C grant flow, minus the
// schedule arming — its sole purpose is to surface + verify the browser grants.
export const GRANT_PERMISSIONS_PROMPT =
  'Hi Claude — please turn on hands-free BROWSER control for my Implexa agents. This is a one-time setup and you do '
  + 'NOT need to run any agent — ONLY surface the permission prompts so I can approve them while I am here. Do this: '
  + '(1) SCREEN CONTROL — call the computer-use request_access tool for Google Chrome and System Events. macOS will pop '
  + '"Claude wants to use your computer — Enable". Tell me to click Enable, then turn ON Screen Recording AND '
  + 'Accessibility for Claude in System Settings (it may ask to re-open Claude). '
  + '(2) CHROME — call list_connected_browsers (claude-in-chrome); if no browser is connected, tell me to click Connect '
  + '/ install + pin the "Claude for Chrome" extension and pair it. '
  + '(3) REPORT — after I respond, re-check via list_granted_applications + list_connected_browsers and call '
  + 'report_runtime_permissions({ computerUse: <true/false>, chrome: <true/false> }) with what you actually found, so my '
  + 'Implexa setup screen verifies it. Then tell me in one line what is now granted and what (if anything) I still need '
  + 'to toggle. (Implexa never sees my logins or credentials.)';

export default function GrantPermissionsButton({
  label = 'Grant browser access',
  surface = 'claude',
  className = 'btn-success text-xs px-3 py-1.5 flex-none whitespace-nowrap disabled:opacity-60',
}: {
  label?: string;
  surface?: string;
  className?: string;
}) {
  const [firing, setFiring] = useState(false);

  async function grant() {
    if (firing) return;
    setFiring(true);
    const bridge = typeof window !== 'undefined'
      ? (window as Window & { implexaDesktop?: Bridge }).implexaDesktop
      : undefined;
    try {
      if (bridge?.handoffAgent) {
        await bridge.handoffAgent(GRANT_PERMISSIONS_PROMPT, surface, 'code');
      } else if (typeof window !== 'undefined') {
        // Web fallback: the same deep link the desktop uses to open a fresh Claude
        // Code session with the prompt prefilled.
        window.location.href = `claude://code/new?q=${encodeURIComponent(GRANT_PERMISSIONS_PROMPT)}`;
      }
    } catch { /* best-effort — the user can retry */ }
    // Re-enable shortly so a user who needs to retry (e.g. Claude wasn't open) can.
    setTimeout(() => setFiring(false), 2500);
  }

  return (
    <button type="button" onClick={grant} disabled={firing} className={className}>
      {firing ? 'Opening Claude…' : `${label} ↗`}
    </button>
  );
}
