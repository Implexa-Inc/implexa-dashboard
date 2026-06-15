/**
 * lib/app-links.ts , implexa:// deep links into the desktop app, gated so they
 * never render as dead links before the app ships (desktop-first posture).
 *
 * The macOS app registers the implexa:// scheme only once it's installed. Until
 * then a deep link 404s for everyone, so we hide the "Open in Implexa app"
 * affordances behind NEXT_PUBLIC_DESKTOP_APP_LIVE. Flip that env to 'true' the
 * day the app goes live (Apple cert) and the "open in app" options light up
 * everywhere at once, with the web path always remaining as the fallback.
 */

export function desktopAppLive(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_APP_LIVE === 'true';
}

/** Public download URL for the live, notarized universal macOS app. */
export function macDownloadUrl(): string {
  return 'https://github.com/Implexa-Inc/implexa-releases/releases/latest/download/Implexa-universal.dmg';
}

export function appActivateUrl(slug: string): string {
  return `implexa://workflows/${encodeURIComponent(slug)}/activate`;
}

export function appRunUrl(runId: string): string {
  return `implexa://runs/${encodeURIComponent(runId)}`;
}

export function appAgentUrl(slug: string): string {
  return `implexa://workflows/${encodeURIComponent(slug)}`;
}
