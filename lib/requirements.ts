/**
 * lib/requirements.ts , "what you'll need" for an agent, derived from its steps.
 *
 * So a user sees the prerequisites BEFORE running an agent, not when it fails
 * halfway. Two kinds:
 *   - tools: free command-line tools the agent auto-installs on first run (the
 *     desktop provisioner + the generated preflight step handle these).
 *   - services: paid/API accounts the user must provide a key or subscription
 *     for (cost + where to get it + any cheaper alternative).
 *
 * Source of truth is the backend's TOOLCHAINS + SERVICES tables
 * (workflow-builder.service.js). Kept in sync here for a read-only display panel;
 * if the backend tables grow, mirror the additions.
 */

export type ReqTool = { name: string; note: string };
// `provider` is the LOCAL_KEY_VAULT slug (backend's API_KEY_PROVIDERS in
// workflow-capabilities.js) when this service has a vault-backed key, else
// null — a service the vault doesn't support yet just keeps its plain "Get it"
// link with no "Add API key" CTA. The two lists must agree on slugs: a
// mismatched or invented provider here would render an "Add API key" button
// that opens the local key window for a provider the vault has never heard of.
export type ReqService = { name: string; cost: string; url: string; alt: string | null; provider: string | null };
export type Requirements = { tools: ReqTool[]; services: ReqService[] };

type Stepish = { label?: string | null; detail?: string | null };

const TOOLS: { re: RegExp; name: string; note: string }[] = [
  { re: /\bremotion\b/i,             name: 'Remotion',    note: 'auto-installs on first run' },
  { re: /\bffmpeg\b/i,               name: 'ffmpeg',      note: 'auto-installs (brew/apt) if missing' },
  { re: /\bwhisper\b/i,              name: 'Whisper',     note: 'auto-installs for transcription' },
  { re: /\b(yt-?dlp|youtube-dl)\b/i, name: 'yt-dlp',      note: 'auto-installs to fetch videos' },
  { re: /\bgdown\b/i,                name: 'gdown',       note: 'auto-installs for Google Drive pulls' },
  { re: /\bplaywright\b/i,           name: 'Playwright',  note: 'auto-installs browser drivers' },
  { re: /\b(imagemagick|\bmagick\b)/i, name: 'ImageMagick', note: 'auto-installs if missing' },
];

const SERVICES: { re: RegExp; name: string; cost: string; url: string; alt: string | null; provider: string | null }[] = [
  { re: /\brunway(\s?ml)?\b/i,            name: 'Runway ML',  cost: 'usage-based (credits)', url: 'https://dev.runwayml.com',  alt: 'Seedance (via HeyGen)', provider: 'runway' },
  { re: /\bheygen\b/i,                    name: 'HeyGen',     cost: 'free trial, then paid', url: 'https://heygen.com',        alt: null, provider: 'heygen' },
  // Seedance rides HeyGen's own key (no separate vault entry) — same provider slug.
  { re: /\bseedance\b/i,                  name: 'Seedance',   cost: 'via HeyGen credits',    url: 'https://heygen.com',        alt: 'Runway ML', provider: 'heygen' },
  { re: /\beleven\s?labs\b/i,             name: 'ElevenLabs', cost: 'free tier, then paid',  url: 'https://elevenlabs.io',     alt: null, provider: 'elevenlabs' },
  // Not yet in the vault's API_KEY_PROVIDERS registry — "Get it" only, no Add-key CTA.
  { re: /\b(openai|dall-?e|gpt-?image)\b/i, name: 'OpenAI',   cost: 'usage-based (API key)', url: 'https://platform.openai.com', alt: null, provider: null },
];

export function detectRequirements(steps: Stepish[] | undefined | null): Requirements {
  const blob = (steps || []).map((s) => `${s.label || ''} ${s.detail || ''}`).join('\n');
  const tools = TOOLS.filter((t) => t.re.test(blob)).map((t) => ({ name: t.name, note: t.note }));
  const services = SERVICES.filter((s) => s.re.test(blob)).map((s) => ({ name: s.name, cost: s.cost, url: s.url, alt: s.alt, provider: s.provider }));
  return { tools, services };
}
