/**
 * lib/vault-view.ts — PURE derivation for /settings/local-vault.
 *
 * All the honesty rules of the vault page live here, testable without React:
 *
 *   1. ABSENT METHOD ≠ FAILED CALL (the founder-hit bug class, see
 *      api-key-row.tsx). A bridge method that doesn't exist means an older
 *      desktop app — a calm fallback. A call that REJECTED means we don't
 *      know — and "don't know" must NEVER render as "ready"/"saved"/"missing".
 *   2. UNREACHABLE ≠ DENIED/UNAVAILABLE (the broker's empty-socket-reply rule,
 *      applied to this surface): a rejected availability check is 'error'
 *      (couldn't ask), while keysAvailable() === false is 'unavailable' (asked,
 *      and this Mac can't store keys — e.g. safeStorage/keychain locked). The
 *      two states get different copy because they have different fixes.
 *   3. A failed key LIST must not claim "No key saved" — that copy invites a
 *      re-paste, and keys:set OVERWRITES the stored value.
 */

export type ListedGrant = { agentSlug: string; grantedAt: string | null; lastUsedAt: string | null };
export type ListedKey = {
  provider: string;
  label: string;
  envVar?: string | null;
  scope?: string | null;
  configuredAt: string | null;
  lastUsedAt?: string | null;
  grantedAgents: string[];
  grants?: ListedGrant[];
};
export type ProviderMeta = { provider: string; label: string; envVar?: string; scope?: string; createUrl?: string };

export type VaultMode = 'loading' | 'web' | 'unsupported' | 'error' | 'unavailable' | 'ready';

/** The status-card state machine. See honesty rules 1 + 2 above. */
export function deriveVaultMode(i: {
  mounted: boolean;
  hasBridge: boolean;
  hasKeysAvailable: boolean;   // feature detection: method present on the bridge
  availableResult: boolean | null; // resolved value; null = not yet resolved
  checkFailed: boolean;        // the call REJECTED
}): VaultMode {
  if (!i.mounted) return 'loading';
  if (!i.hasBridge) return 'web';
  if (!i.hasKeysAvailable) return 'unsupported';
  if (i.checkFailed) return 'error'; // we could not ASK — distinct from a "no" answer
  if (i.availableResult === null) return 'loading';
  return i.availableResult ? 'ready' : 'unavailable';
}

export type ProviderCardState = {
  provider: string;
  label: string;
  scope?: string;
  createUrl?: string;
  /** 'unknown' whenever we could not actually learn the truth (rule 3). */
  state: 'saved' | 'missing' | 'unknown';
  savedAt: string | null;
  lastUsedAt: string | null;
  grants: ListedGrant[];
  /** False on an older desktop that has no per-grant metadata (listKeys absent):
   * saved/missing still render from the legacy keysConfigured booleans, but the
   * access list can't be shown, and the card says to update the app instead. */
  canManageAccess: boolean;
};

export function deriveProviderCards(i: {
  registry: ProviderMeta[];
  /** listKeys() result; null = the method is absent (older app). */
  listed: ListedKey[] | null;
  /** the listKeys() call rejected — we do NOT know what is saved. */
  listFailed: boolean;
  /** legacy fallback when listKeys is absent: keysConfigured() booleans (null = also absent/failed). */
  configuredFallback: Record<string, boolean> | null;
}): ProviderCardState[] {
  const bySlug = new Map((i.listed || []).map((k) => [k.provider, k]));
  return i.registry.map((meta) => {
    const base = {
      provider: meta.provider, label: meta.label, scope: meta.scope, createUrl: meta.createUrl,
      savedAt: null as string | null, lastUsedAt: null as string | null,
      grants: [] as ListedGrant[],
    };
    if (i.listFailed) {
      // Rule 3: never render "No key saved" off a failed read.
      return { ...base, state: 'unknown' as const, canManageAccess: false };
    }
    if (i.listed) {
      const row = bySlug.get(meta.provider);
      if (!row) return { ...base, state: 'missing' as const, canManageAccess: true };
      const grants: ListedGrant[] = row.grants
        || row.grantedAgents.map((agentSlug) => ({ agentSlug, grantedAt: null, lastUsedAt: null }));
      return {
        ...base,
        state: 'saved' as const,
        savedAt: row.configuredAt,
        lastUsedAt: row.lastUsedAt || null,
        grants,
        canManageAccess: true,
      };
    }
    // Older app: presence booleans only, no metadata, no per-agent management.
    if (i.configuredFallback) {
      return i.configuredFallback[meta.provider] === true
        ? { ...base, state: 'saved' as const, canManageAccess: false }
        : { ...base, state: 'missing' as const, canManageAccess: false };
    }
    return { ...base, state: 'unknown' as const, canManageAccess: false };
  });
}

/** Agents that may need this provider's key and are NOT yet granted — the
 * one-click Allow list. Granted slugs win regardless of roster casing drift. */
export function allowCandidates(
  mayNeed: Array<{ slug: string; name: string }> | undefined,
  grants: ListedGrant[],
): Array<{ slug: string; name: string }> {
  const granted = new Set(grants.map((g) => g.agentSlug.toLowerCase()));
  return (mayNeed || []).filter((a) => !granted.has(a.slug.toLowerCase()));
}

/** "3h ago"-style formatting for locally-sourced timestamps. */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
}
