/**
 * Role-based starter packs — drives the post-signup onboarding step.
 *
 * When a new user picks a role, we auto-fork these Playbooks into their org.
 * They land on /skills with a library that feels personal, not empty.
 *
 * The user's later skill captures replace these as their library matures —
 * the starter pack is the *training wheels* moment, not the long-term library.
 */

export type RoleSlug = 'sales' | 'recruiting' | 'customer-success' | 'founder' | 'engineering' | 'other';

export type RolePack = {
  slug: RoleSlug;
  label: string;
  icon: string;
  /** One-line "I do X" framing. */
  tagline: string;
  /** What gets auto-forked when this role is selected. */
  starterPlaybooks: string[];
  /** Why this role gets THIS specific set — shown in onboarding card. */
  rationale: string;
};

export const ROLE_PACKS: RolePack[] = [
  {
    slug: 'sales',
    label: 'Sales / GTM',
    icon: '🎯',
    tagline: 'I sell, prospect, or run a revenue team.',
    starterPlaybooks: [
      'research-a-prospect',
      'draft-a-cold-email',
      'find-decision-makers',
      'full-account-research',
      'pre-meeting-prep',
      'cold-outreach-sequence',
      'competitor-scan',
    ],
    rationale: '7 agents covering the daily SDR / AE / RevOps motion — prospect research, cold outreach, meeting prep, competitive intel.',
  },
  {
    slug: 'recruiting',
    label: 'Recruiting / Staffing',
    icon: '🧑‍💼',
    tagline: 'I source, screen, or place candidates.',
    starterPlaybooks: [
      'source-candidates-by-skill',
      'screen-a-candidate',
      'interview-prep-brief',
      'redeploy-candidate',
      'pre-meeting-prep',
      'draft-an-email',
    ],
    rationale: '6 agents covering sourcing → screening → interview prep → redeployment, plus shared meeting + email helpers.',
  },
  {
    slug: 'customer-success',
    label: 'Customer Success',
    icon: '🤝',
    tagline: 'I onboard, retain, or grow customer accounts.',
    starterPlaybooks: [
      'customer-health-check',
      'qbr-prep',
      'expansion-opportunity',
      'escalation-response',
      'renewal-risk-brief',
      'pre-meeting-prep',
    ],
    rationale: '6 agents covering health checks, QBR prep, expansion plays, escalations, and renewal-risk briefs.',
  },
  {
    slug: 'founder',
    label: 'Founder / CEO',
    icon: '⚡',
    tagline: 'I wear every hat — sales, product, hiring, ops.',
    starterPlaybooks: [
      // Founders need range — pull the most-leveraged Playbook from each vertical
      'research-a-topic',
      'daily-brief',
      'pre-meeting-prep',
      'draft-an-email',
      'research-a-prospect',
      'find-decision-makers',
      'screen-a-candidate',
      'customer-health-check',
      'social-post-draft',
      'runway-check',
    ],
    rationale: '10 cross-functional agents — research, daily ops, prospecting, hiring, customer pulse, public posts, runway. Most-leveraged one from each function.',
  },
  {
    slug: 'engineering',
    label: 'Engineering',
    icon: '🛠️',
    tagline: 'I build, review code, or run an engineering team.',
    starterPlaybooks: [
      'pr-review-checklist',
      'bug-triage',
      'release-notes-draft',
      'research-a-topic',
      'draft-an-email',
      'one-on-one-prep',
    ],
    rationale: '6 agents — code review checklist, bug triage, release notes, plus shared research + 1:1 + email helpers.',
  },
  {
    slug: 'other',
    label: 'Something else',
    icon: '🌐',
    tagline: 'I do work that doesn\'t fit a single bucket.',
    starterPlaybooks: [
      // The 5 horizontal Playbooks — useful for anyone
      'research-a-topic',
      'pre-meeting-prep',
      'daily-brief',
      'draft-an-email',
      'onboarding-context',
    ],
    rationale: '5 cross-functional agents that work for anyone — research, meeting prep, daily brief, email drafting, new-hire onboarding.',
  },
];

export function getRolePack(slug: string): RolePack | undefined {
  return ROLE_PACKS.find((r) => r.slug === slug);
}
