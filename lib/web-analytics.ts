/**
 * What app.implexa.ai sends to Vercel Web Analytics.
 *
 * Page URLs in this app can carry secrets: one-time auth codes and reset
 * tokens in the query string (/auth/callback?code=, ?token_hash=), session
 * tokens in the #fragment, and capability tokens in share links (/s/<token>,
 * /s/run/<token>). Analytics only needs the page and the marketing source, so
 * every URL is reduced to origin + path + the allowlisted source parameters
 * below, with share tokens masked. Anything that is not a parseable URL is
 * dropped rather than sent.
 */

// Marketing source parameters only (same keys as lib/signup-attribution.ts).
const KEPT_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'cta', 'lp',
];

// Path segments that are capability tokens: anyone holding the URL can open it.
const TOKEN_PATHS: Array<[RegExp, string]> = [
  [/^\/s\/run\/[^/]+/, '/s/run/[token]'],
  [/^\/s\/(?!run(?:\/|$))[^/]+/, '/s/[token]'],
];

export function scrubAnalyticsUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  let path = url.pathname;
  for (const [pattern, mask] of TOKEN_PATHS) {
    if (pattern.test(path)) {
      path = path.replace(pattern, mask);
      break;
    }
  }
  const kept = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) kept.set(key, value.slice(0, 200));
  }
  const query = kept.toString();
  return `${url.origin}${path}${query ? `?${query}` : ''}`;
}
