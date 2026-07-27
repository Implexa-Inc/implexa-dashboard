/**
 * A per-slug, in-memory draft of an agent's standing "Notes for this agent",
 * shared between the two client surfaces that touch it:
 *   • the Setup card (<AgentSetupCard>), where the note is edited, and
 *   • the Run-now pop-up (<AgentActions>), which shows it so it's visibly in
 *     effect and saves it on "Save & run".
 *
 * WHY: the two are separate React components. A user who types into the Setup
 * note and clicks Run now WITHOUT clicking "Save answers" first would otherwise
 * lose that text — the pop-up fetches only the SAVED note. This module carries
 * the unsaved edit across so the pop-up seeds from it. In-memory + per-tab only
 * (never persisted); cleared once the note is actually saved.
 *
 * This is the standing note ONLY. The one-off per-run note is a different channel
 * (run-request `note`) and never flows through here.
 */

const drafts = new Map<string, string>();

export function setAgentNoteDraft(slug: string, value: string): void {
  if (slug) drafts.set(slug, value);
}

export function getAgentNoteDraft(slug: string): string | undefined {
  return slug ? drafts.get(slug) : undefined;
}

export function clearAgentNoteDraft(slug: string): void {
  if (slug) drafts.delete(slug);
}
