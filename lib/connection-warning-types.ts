// connection-warning-types.ts — the CLIENT-SAFE slice of lib/connections.ts.
//
// lib/connections.ts pulls in lib/supabase/server (next/headers) via a dynamic
// import, which Next.js's bundler flags transitively for ANY module that
// imports anything from that file — so a 'use client' component (e.g.
// <ConnectionAttentionBanner/>, once it started calling the desktop bridge
// directly instead of a static link) can't import even a type/constant from
// lib/connections.ts without breaking the client build. This file holds the
// pieces a client component actually needs, with zero other imports, so it's
// safe on both sides. lib/connections.ts re-exports these for its existing
// server-side importers — nothing else changes for them.

export type ConnectionWarning = {
  agent_slug: string;
  agent_name: string;
  label: string;
  account: string | null;
  domain: string;
  reason: string;
  detected_at: string | null;
};

// Where the user signs an account back in when no desktop bridge is available
// (a plain browser tab). Inside the desktop app, prefer the bridge's
// connectAccount/verifyAccount (window.implexaDesktop) instead — see
// <ConnectionAttentionBanner/>.
export const RECONNECT_HREF = '/install';
