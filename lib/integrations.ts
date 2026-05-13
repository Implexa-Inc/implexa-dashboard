/**
 * Integration catalog — single source of truth for the /integrations page.
 *
 * Each entry maps an integration to:
 *   - The Implexa MCP tools it powers (used to rank "Recommended for you")
 *   - Setup metadata (auth type, status, category)
 *
 * When a new integration ships, add it here + flip status from
 * 'coming-soon' → 'beta' → 'available'.
 */

export type IntegrationCategory =
  | 'gtm'
  | 'recruiting'
  | 'cs'
  | 'productivity'
  | 'product-eng'
  | 'finance';

export type IntegrationStatus = 'available' | 'beta' | 'coming-soon';

export type AuthType = 'apikey' | 'oauth';

export type Integration = {
  slug: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  tier: 1 | 2 | 3;
  status: IntegrationStatus;
  logo: string; // emoji for now; replace with image path later
  authType: AuthType;
  /** Implexa MCP tools this integration unlocks. Used for "recommended for you" ranking. */
  tools: string[];
  /** Optional setup URL once available (apikey provider docs, etc.). */
  setupHelpUrl?: string;
};

export const CATEGORY_META: Record<IntegrationCategory, { label: string; icon: string; order: number }> = {
  gtm:           { label: 'GTM / Sales',           icon: '🎯', order: 1 },
  recruiting:    { label: 'Recruiting / Staffing', icon: '🧑‍💼', order: 2 },
  cs:            { label: 'Customer Success',      icon: '🤝', order: 3 },
  productivity:  { label: 'Productivity',          icon: '⚡', order: 4 },
  'product-eng': { label: 'Product Engineering',   icon: '🛠️', order: 5 },
  finance:       { label: 'Finance / FP&A',        icon: '💰', order: 6 },
};

export const INTEGRATIONS: Integration[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // 🎯 GTM / Sales — Tier 1 (prospect data)
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'fiber',
    name: 'Fiber AI',
    description: 'Company firmographics + LinkedIn enrichment + buying signals.',
    category: 'gtm', tier: 1, status: 'available', logo: '🌿', authType: 'apikey',
    tools: ['lookup_company', 'lookup_person', 'lookup_domain', 'find_accounts'],
    setupHelpUrl: 'https://fiberai.com/dashboard',
  },
  {
    slug: 'coresignal',
    name: 'Coresignal',
    description: 'Global job postings, candidate database, and LinkedIn post lookups.',
    category: 'gtm', tier: 1, status: 'available', logo: '📡', authType: 'apikey',
    tools: ['find_job_postings', 'find_prospects_by_career_history', 'lookup_linkedin_posts'],
    setupHelpUrl: 'https://coresignal.com/app/api',
  },
  {
    slug: 'apollo',
    name: 'Apollo.io',
    description: 'Verified emails + phones for B2B contacts at scale.',
    category: 'gtm', tier: 1, status: 'available', logo: '🚀', authType: 'apikey',
    tools: ['enrich_contacts', 'find_person', 'lookup_email', 'find_prospects'],
    setupHelpUrl: 'https://app.apollo.io/#/settings/integrations',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 🎯 GTM / Sales — Tier 2 (CRM + revenue intelligence)
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'salesforce',
    name: 'Salesforce',
    description: 'Push contacts, activities, and pipeline updates. Read accounts and opportunities.',
    category: 'gtm', tier: 2, status: 'coming-soon', logo: '☁️', authType: 'oauth',
    tools: ['crm_query', 'crm_push_contacts', 'crm_describe_objects', 'crm_describe_fields'],
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    description: 'CRM read + write — contacts, deals, marketing activities, lifecycle stages.',
    category: 'gtm', tier: 2, status: 'coming-soon', logo: '🟧', authType: 'oauth',
    tools: ['crm_query', 'crm_push_contacts'],
  },
  {
    slug: 'gong',
    name: 'Gong',
    description: 'Call recordings + transcripts for pre-meeting prep and competitive intel.',
    category: 'gtm', tier: 2, status: 'coming-soon', logo: '🎙️', authType: 'oauth',
    tools: ['search_call_transcripts'],
  },
  {
    slug: 'chorus',
    name: 'Chorus.ai',
    description: 'Revenue conversation intelligence — calls, meetings, deal moments.',
    category: 'gtm', tier: 2, status: 'coming-soon', logo: '🎤', authType: 'oauth',
    tools: ['search_call_transcripts'],
  },
  {
    slug: 'outreach',
    name: 'Outreach',
    description: 'Sales engagement — sequences, calls, replies tracked back to Implexa skills.',
    category: 'gtm', tier: 2, status: 'coming-soon', logo: '📣', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'salesloft',
    name: 'Salesloft',
    description: 'Engagement cadences with reply + meeting attribution.',
    category: 'gtm', tier: 2, status: 'coming-soon', logo: '🔁', authType: 'oauth',
    tools: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 🧑‍💼 Recruiting / Staffing
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'bullhorn',
    name: 'Bullhorn',
    description: 'Read/write candidates, placements, job orders. Powers the staffing Playbooks end-to-end.',
    category: 'recruiting', tier: 2, status: 'coming-soon', logo: '📢', authType: 'oauth',
    tools: ['crm_query', 'crm_push_contacts'],
  },
  {
    slug: 'workday',
    name: 'Workday',
    description: 'HRIS + recruiting workflows — open reqs, candidate stages, placements.',
    category: 'recruiting', tier: 2, status: 'coming-soon', logo: '🏢', authType: 'oauth',
    tools: ['crm_query'],
  },
  {
    slug: 'linkedin-recruiter',
    name: 'LinkedIn Recruiter',
    description: 'Source candidates, send InMails, sync profile data into skills.',
    category: 'recruiting', tier: 2, status: 'coming-soon', logo: '💼', authType: 'oauth',
    tools: ['find_prospects', 'lookup_person'],
  },
  {
    slug: 'greenhouse',
    name: 'Greenhouse',
    description: 'ATS read + write — applications, interview kits, scorecards.',
    category: 'recruiting', tier: 2, status: 'coming-soon', logo: '🌱', authType: 'oauth',
    tools: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 🤝 Customer Success
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'gainsight',
    name: 'Gainsight',
    description: 'Health scores, CTAs, and customer success playbooks tied to Implexa skills.',
    category: 'cs', tier: 2, status: 'coming-soon', logo: '💚', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'zendesk',
    name: 'Zendesk',
    description: 'Support tickets + customer context for escalation-response skills.',
    category: 'cs', tier: 2, status: 'coming-soon', logo: '🎫', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'intercom',
    name: 'Intercom',
    description: 'Customer messaging, conversation history, and user context.',
    category: 'cs', tier: 2, status: 'coming-soon', logo: '💬', authType: 'oauth',
    tools: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ⚡ Productivity (email, calendar, messaging, docs)
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Draft, send, and read emails. Turns drafting Playbooks into end-to-end workflows.',
    category: 'productivity', tier: 2, status: 'coming-soon', logo: '✉️', authType: 'oauth',
    tools: ['generate_message'],
  },
  {
    slug: 'outlook',
    name: 'Outlook',
    description: 'Email + calendar via Microsoft Graph.',
    category: 'productivity', tier: 2, status: 'coming-soon', logo: '📨', authType: 'oauth',
    tools: ['generate_message', 'get_calendar_events'],
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    description: 'Reads upcoming meetings — powers pre-meeting prep and daily brief Playbooks.',
    category: 'productivity', tier: 2, status: 'coming-soon', logo: '📅', authType: 'oauth',
    tools: ['get_calendar_events', 'get_calendar_stakeholders'],
  },
  {
    slug: 'slack',
    name: 'Slack',
    description: 'Post messages, run /implexa commands from Slack, route notifications.',
    category: 'productivity', tier: 2, status: 'coming-soon', logo: '💬', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'teams',
    name: 'Microsoft Teams',
    description: 'Messages + meetings inside Teams.',
    category: 'productivity', tier: 2, status: 'coming-soon', logo: '💜', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Read pages, write docs, sync skill outputs to a knowledge base.',
    category: 'productivity', tier: 2, status: 'coming-soon', logo: '📝', authType: 'oauth',
    tools: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 🛠️ Product Engineering
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'github',
    name: 'GitHub',
    description: 'PRs, issues, releases — powers the pr-review-checklist and release-notes Playbooks.',
    category: 'product-eng', tier: 2, status: 'coming-soon', logo: '🐙', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Issues + sprint context for bug triage and engineering standups.',
    category: 'product-eng', tier: 2, status: 'coming-soon', logo: '📐', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'jira',
    name: 'Jira',
    description: 'Project tracking — issues, sprints, releases.',
    category: 'product-eng', tier: 3, status: 'coming-soon', logo: '🌀', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    description: 'Errors + performance issues for bug-triage skills.',
    category: 'product-eng', tier: 3, status: 'coming-soon', logo: '🛡️', authType: 'oauth',
    tools: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 💰 Finance / FP&A
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Revenue, customers, subscriptions — runway and churn signals for finance Playbooks.',
    category: 'finance', tier: 2, status: 'coming-soon', logo: '💳', authType: 'apikey',
    tools: [],
  },
  {
    slug: 'quickbooks',
    name: 'QuickBooks',
    description: 'Accounting + expense data — feeds expense-categorize and runway-check Playbooks.',
    category: 'finance', tier: 2, status: 'coming-soon', logo: '📊', authType: 'oauth',
    tools: [],
  },
  {
    slug: 'brex',
    name: 'Brex',
    description: 'Corporate card + spend data for finance and expense workflows.',
    category: 'finance', tier: 3, status: 'coming-soon', logo: '💎', authType: 'oauth',
    tools: [],
  },
];

/** Build a Map for quick tool-name → integration[] lookup. */
const TOOL_TO_INTEGRATIONS: Map<string, Integration[]> = (() => {
  const m = new Map<string, Integration[]>();
  for (const integ of INTEGRATIONS) {
    for (const tool of integ.tools) {
      const list = m.get(tool) || [];
      list.push(integ);
      m.set(tool, list);
    }
  }
  return m;
})();

/** Given a tool name, return the integrations that power it (if any). */
export function integrationsForTool(toolName: string): Integration[] {
  return TOOL_TO_INTEGRATIONS.get(toolName) || [];
}

/** Group by category, ordered by CATEGORY_META.order. */
export function integrationsByCategory(integrations: Integration[]): Array<{
  category: IntegrationCategory;
  meta: typeof CATEGORY_META[IntegrationCategory];
  items: Integration[];
}> {
  const grouped = new Map<IntegrationCategory, Integration[]>();
  for (const integ of integrations) {
    const list = grouped.get(integ.category) || [];
    list.push(integ);
    grouped.set(integ.category, list);
  }
  return Array.from(grouped.entries())
    .map(([category, items]) => ({ category, meta: CATEGORY_META[category], items }))
    .sort((a, b) => a.meta.order - b.meta.order);
}
