/**
 * Common tools per kind of work, offered as tags on /coach.
 *
 * Category ids match CATEGORIES in app/coach/coach-form.tsx and the backend's
 * coach_interest allowlist. Picked tags and any typed "other tools" are sent as
 * one comma-separated `tools` string, so the backend needs no tool list.
 */

export const TOOLS_BY_CATEGORY: Record<string, readonly string[]> = {
  video: ['Higgsfield', 'Runway', 'HeyGen', 'Kling', 'Veo', 'DaVinci Resolve', 'Premiere Pro', 'After Effects', 'CapCut', 'Descript', 'Remotion'],
  marketing: ['Google Ads', 'Meta Ads (Facebook, Instagram)', 'TikTok Ads', 'Google Analytics', 'HubSpot', 'Klaviyo', 'Semrush', 'Ahrefs', 'Canva'],
  design: ['Figma', 'Midjourney', 'Adobe Firefly', 'Photoshop', 'Illustrator', 'Ideogram', 'Canva'],
  writing: ['ChatGPT', 'Claude', 'Jasper', 'Notion', 'Grammarly', 'Google Docs'],
  development: ['Claude Code', 'Codex', 'Cursor', 'GitHub Copilot', 'Lovable', 'Replit', 'v0', 'Supabase', 'Vercel'],
  sales: ['HubSpot', 'Salesforce', 'Apollo', 'Clay', 'LinkedIn Sales Navigator', 'Instantly', 'Gong'],
  research: ['Perplexity', 'ChatGPT Deep Research', 'NotebookLM', 'Claude', 'Excel', 'Google Sheets', 'Tableau'],
  other: [],
};

const KNOWN = new Set(Object.values(TOOLS_BY_CATEGORY).flat());

/** Tags to show for the chosen categories, without repeats, in category order. */
export function toolsFor(categories: readonly string[]): string[] {
  const out: string[] = [];
  for (const c of categories) for (const t of TOOLS_BY_CATEGORY[c] ?? []) if (!out.includes(t)) out.push(t);
  return out;
}

/** Split a saved `tools` string back into picked tags and free text. */
export function splitTools(saved: string | null | undefined): { picked: string[]; other: string } {
  const parts = (saved ?? '').split(/,\s*(?![^()]*\))/).map((p) => p.trim()).filter(Boolean);
  return {
    picked: parts.filter((p) => KNOWN.has(p)),
    other: parts.filter((p) => !KNOWN.has(p)).join(', '),
  };
}

/** The single string the backend stores. */
export function joinTools(picked: readonly string[], other: string): string {
  return [...picked, other.trim()].filter(Boolean).join(', ');
}
