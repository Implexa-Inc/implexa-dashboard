/**
 * agent-authority-delta.ts — turning the backend's authority comparison into the
 * sentence an owner has to make a decision from (spec §3.2).
 *
 * The approval screen must show "the exact authority delta". Exact does not mean
 * raw: `{ permission_groups: ['shell'], destructive: ['deploy'] }` is precise and
 * tells the owner nothing about what their agent will now be able to do. An
 * approval nobody understands is a click, not a decision — and a gate that
 * produces clicks is worse than no gate, because it launders the risky change
 * through an approval that looks deliberate.
 *
 * So each axis member is mapped to plain language, and anything unrecognized is
 * shown VERBATIM rather than dropped. A capability we have no phrasing for is
 * still a capability the agent gained; silently omitting it would make the diff
 * a lie in exactly the case that matters most.
 */

/** The wire shape, mirroring the backend's compareExecutionAuthority output. */
export type AgentAuthorityDelta = {
  added?: Record<string, string[] | Record<string, { from: number; to: number }>> | null;
  removed?: Record<string, string[] | Record<string, { from: number; to: number }>> | null;
  reasons?: string[] | null;
} | null | undefined;

export type DescribedAuthorityDelta = {
  hasChanges: boolean;
  added: string[];
  removed: string[];
};

/** Permission groups, as permission-tiers names them on the backend. */
const GROUP_LABELS: Record<string, string> = {
  web: 'read web pages',
  files_r: 'read your files',
  files_w: 'write files in your workspace',
  implexa: 'use Implexa’s own tools',
  browser: 'act in your browser as you',
  shell: 'run commands on your computer',
  send: 'send or post on your behalf',
  external: 'use an external tool',
  other: 'use an unrecognized tool',
};

const CAPABILITY_LABELS: Record<string, string> = {
  browser: 'control a browser',
  computer_use: 'control your screen and keyboard',
};

const DESTRUCTIVE_LABELS: Record<string, string> = {
  write: 'write or change data',
  publish: 'publish content',
  send: 'send messages on your behalf',
  purchase: 'spend money',
  deploy: 'deploy or run commands',
  delete: 'delete data',
};

const AXIS_PREFIX: Record<string, string> = {
  permission_groups: '',
  capabilities: '',
  accounts: 'access the account ',
  secrets: 'use the credential ',
  providers: 'use the paid provider ',
  destructive: '',
  machines: 'run on ',
};

function labelFor(axis: string, member: string): string {
  if (axis === 'permission_groups') return GROUP_LABELS[member] || `permission: ${member}`;
  if (axis === 'capabilities') return CAPABILITY_LABELS[member] || `capability: ${member}`;
  if (axis === 'destructive') return DESTRUCTIVE_LABELS[member] || `authority: ${member}`;
  return `${AXIS_PREFIX[axis] ?? `${axis}: `}${member}`;
}

/**
 * Minor units to a readable amount, WITH its currency. The ceiling is the whole
 * decision on this axis, and "spend up to 50.00 per run" leaves the owner
 * guessing whether that is dollars, yen, or cents.
 */
function money(minor: number, currency: string): string {
  const amount = (minor / 100).toFixed(2);
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`;
}

function describeAxis(
  axis: string,
  value: string[] | Record<string, { from: number; to: number }>,
  direction: 'added' | 'removed',
): string[] {
  if (axis === 'spend') {
    // Spend is the one axis with a magnitude, and the magnitude IS the decision:
    // "raise the Runway ceiling" and "raise it from $2.50 to $50.00 per run" are
    // different questions.
    return Object.entries(value as Record<string, { from: number; to: number }>).map(([key, change]) => {
      // The backend keys spend as `<provider>:<CURRENCY>`.
      const [provider, currency = 'USD'] = key.split(':');
      return direction === 'added'
        ? `spend up to ${money(change.to, currency)} per run on ${provider}`
          + (change.from > 0 ? ` (was ${money(change.from, currency)})` : '')
        : `spend limit on ${provider} lowered to ${money(change.to, currency)}`;
    });
  }
  return (Array.isArray(value) ? value : []).map((member) => labelFor(axis, member));
}

/**
 * describeAuthorityDelta(delta) -> the plain-language gains and give-ups.
 *
 * A null or empty delta reports `hasChanges: false` so the caller renders no
 * panel at all — an update that changes no authority should not display an empty
 * "what changed" box, which reads as reassurance the data does not support.
 */
export function describeAuthorityDelta(delta: AgentAuthorityDelta): DescribedAuthorityDelta {
  const added: string[] = [];
  const removed: string[] = [];
  for (const [axis, value] of Object.entries(delta?.added || {})) {
    if (value) added.push(...describeAxis(axis, value, 'added'));
  }
  for (const [axis, value] of Object.entries(delta?.removed || {})) {
    if (value) removed.push(...describeAxis(axis, value, 'removed'));
  }
  return { hasChanges: added.length > 0 || removed.length > 0, added, removed };
}
