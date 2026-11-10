/**
 * Where a sign-up came from.
 *
 * implexa.ai adds the visit's source to every link to /signup (cta, lp, ref,
 * utm_*; see the website's lib/signup-attribution.ts). /signup keeps it in a
 * first-party cookie so it survives the Google/GitHub/email round-trip, and
 * /onboarding sends it with the provision call, where the backend saves it once
 * on the new account. A cookie rather than localStorage because /onboarding
 * usually provisions server-side and never renders client code.
 *
 * Only an allowlist of short string fields is ever kept.
 */

export const ATTRIBUTION_COOKIE = 'implexa_signup_src';
const COOKIE_MAX_AGE_S = 24 * 60 * 60;
const MAX_VALUE = 200;

const PARAM_KEYS = [
  'cta', 'lp', 'ref', 'intent',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
] as const;

type Key = (typeof PARAM_KEYS)[number] | 'entry';
export type SignupAttribution = Partial<Record<Key, string>>;

const OWN_HOSTS = new Set(['implexa.ai', 'www.implexa.ai', 'app.implexa.ai']);

function clip(v: string): string {
  return v.trim().slice(0, MAX_VALUE);
}

/**
 * Build the record from the /signup URL and document.referrer. `entry` says
 * whether the visitor came through the website's sign-up links or straight to
 * the app; for a straight visit an external referrer host stands in for `ref`.
 */
export function attributionFromSignup(params: URLSearchParams, referrer: string): SignupAttribution {
  const out: SignupAttribution = {};
  for (const key of PARAM_KEYS) {
    const v = params.get(key);
    if (v && clip(v)) out[key] = clip(v);
  }
  out.entry = out.cta || out.lp ? 'website' : 'direct';
  if (!out.ref) {
    try {
      const host = new URL(referrer).hostname.toLowerCase();
      if (host && !OWN_HOSTS.has(host)) out.ref = clip(host.replace(/^www\./, ''));
    } catch {
      // no referrer
    }
  }
  return out;
}

/** Keep only allowlisted string fields. Accepts anything; returns null if empty. */
export function sanitizeAttribution(value: unknown): SignupAttribution | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const out: SignupAttribution = {};
  for (const key of [...PARAM_KEYS, 'entry'] as Key[]) {
    const v = src[key];
    if (typeof v === 'string' && clip(v)) out[key] = clip(v);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function serializeAttributionCookie(a: SignupAttribution): string {
  return `${ATTRIBUTION_COOKIE}=${encodeURIComponent(JSON.stringify(a))}; Max-Age=${COOKIE_MAX_AGE_S}; Path=/; SameSite=Lax; Secure`;
}

/** Parse the raw cookie value (as next/headers cookies() returns it). */
export function parseAttributionCookie(raw: string | undefined): SignupAttribution | null {
  if (!raw) return null;
  try {
    return sanitizeAttribution(JSON.parse(decodeURIComponent(raw)));
  } catch {
    return null;
  }
}

/** True when document.cookie already holds a record (first touch wins). */
export function hasAttributionCookie(cookieHeader: string): boolean {
  return cookieHeader.split(/;\s*/).some((c) => c.startsWith(`${ATTRIBUTION_COOKIE}=`));
}
