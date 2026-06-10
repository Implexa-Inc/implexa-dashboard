// agent-category.ts — a fixed, human category per agent for scannability
// (founder: "add icons and a category for each agent for easy visualization
// like productivity, growth, social media etc").
//
// Derivation is keyword-based over name + description + vertical, against a
// FIXED set so the list stays coherent (no free-form categories drifting per
// agent). First match wins; order encodes specificity (video before content,
// social before growth).

export type AgentCategory = {
  key: string;
  label: string;
  emoji: string;
};

const CATEGORIES: Array<AgentCategory & { re: RegExp }> = [
  { key: 'video',    label: 'Video',        emoji: '🎬', re: /\b(video|reel|render|recording|clean.?cut|clip|footage|remotion|heygen|film)\b/i },
  { key: 'social',   label: 'Social media', emoji: '📣', re: /\b(instagram|ig\b|linkedin|twitter|\bx\b|hacker.?news|\bhn\b|social|post|comment|karma|engage)\b/i },
  { key: 'content',  label: 'Content',      emoji: '✍️', re: /\b(blog|seo|content|article|guide|copy|newsletter|script|writing|draft)\b/i },
  { key: 'growth',   label: 'Growth',       emoji: '📈', re: /\b(signup|install|lead|prospect|icp|outreach|sales|pipeline|revenue|growth|funnel|conversion)\b/i },
  { key: 'research', label: 'Research',     emoji: '🔎', re: /\b(research|digest|brief|watch|monitor|competitor|news|pulse|scan|track|report)\b/i },
  { key: 'ops',      label: 'Ops',          emoji: '⚙️', re: /\b(email|inbox|calendar|invoice|billing|file|backup|deploy|triage|standup|meeting)\b/i },
];

const DEFAULT_CATEGORY: AgentCategory = { key: 'assistant', label: 'Productivity', emoji: '✨' };

export function categorizeAgent(parts: Array<string | null | undefined>): AgentCategory {
  const blob = parts.filter(Boolean).join(' ');
  for (const c of CATEGORIES) {
    if (c.re.test(blob)) return { key: c.key, label: c.label, emoji: c.emoji };
  }
  return DEFAULT_CATEGORY;
}
