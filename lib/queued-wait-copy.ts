/**
 * lib/queued-wait-copy.ts — what we may honestly tell someone whose run has sat
 * queued for a while.
 *
 * THE COPY THIS REPLACES said, for EVERY long-queued run:
 *
 *   "Still waiting for an available Claude session on your Mac to pick this up.
 *    Most often that means Claude (or the Implexa app) isn't open, your Mac
 *    slept, or you've hit your Claude 5-hour usage limit. It runs automatically
 *    once Claude is free again — nothing's lost."
 *
 * Three separate untruths for an AUTO-ROUTED request, which is the default:
 *
 *   1. It is not waiting for Claude. Implexa picks an engine at claim time, and
 *      Codex is a first-class one — a capped Claude is not a blocked queue.
 *   2. "It runs once Claude is free again" tells the user to wait out a five-hour
 *      window that has nothing to do with their run. The founder read exactly this
 *      while a perfectly healthy Codex sat idle.
 *   3. It states a CAUSE ("most often that means…") that nothing measured. When the
 *      backend HAS diagnosed a specific block, that diagnosis is the thing to show;
 *      when it hasn't, a guess dressed as a finding sends people to fix nothing.
 *
 * So: name an engine only when we actually know this agent is pinned to one, never
 * assert an engine is unavailable, and surface a specific block only when the
 * backend declared it. Pure, so the whole matrix is unit-testable.
 */

/** How long a run may sit queued before we say anything at all. */
export const QUEUED_WAIT_MS = 8 * 60 * 1000;

export type QueuedWaitInput = {
  status: string;
  /** When it was queued (ISO). */
  since: string | null;
  nowMs: number;
  /**
   * The engine this agent is PINNED to, when the feed knows one. Today's live feed
   * carries no pin for a queued card, so this is normally null and the copy stays
   * engine-neutral — which is the correct answer for an auto-routed request. It is
   * a parameter rather than an assumption so that naming an engine stays gated on
   * actually knowing the pin, not on which engine we happened to think of first.
   */
  enginePreference?: 'claude' | 'codex' | null;
  /**
   * A block the BACKEND declared for this run (the Stalled Run Manager's
   * blockerMessage). Null means nothing has diagnosed a block — which must read as
   * "we don't know yet", never as a guessed cause.
   */
  declaredBlock?: string | null;
};

export type QueuedWaitNotice = {
  headline: string;
  /** The backend's declared block, when there is one. */
  block: string | null;
  /** Non-diagnostic reassurance. Never asserts a cause and never names a blocker. */
  detail: string;
};

const ENGINE_LABEL: Record<'claude' | 'codex', string> = { claude: 'Claude', codex: 'Codex' };

/**
 * @returns the notice to render, or null when there is nothing honest to say yet.
 */
export function queuedWaitNotice(input: QueuedWaitInput): QueuedWaitNotice | null {
  if (!input || input.status !== 'queued') return null;
  if (!input.since) return null;
  const elapsed = input.nowMs - new Date(input.since).getTime();
  if (!Number.isFinite(elapsed) || elapsed <= QUEUED_WAIT_MS) return null;

  const pin = input.enginePreference === 'claude' || input.enginePreference === 'codex'
    ? input.enginePreference
    : null;

  // An engine is named ONLY when the agent is genuinely pinned to it. Otherwise the
  // run is auto-routed and the true statement is that Implexa is choosing.
  const headline = pin
    ? `Still queued. This agent is pinned to ${ENGINE_LABEL[pin]}, so it waits for ${ENGINE_LABEL[pin]} specifically.`
    : 'Still queued. Implexa is picking an available engine on your Mac to run this.';

  const declared = typeof input.declaredBlock === 'string' && input.declaredBlock.trim()
    ? input.declaredBlock.trim()
    : null;

  // NO CAUSE IS ASSERTED HERE. This says what is true of the queue itself (it is
  // still being routed, nothing is lost) and what the user can do — not why.
  const detail = pin
    ? 'It starts as soon as that engine is free and the Implexa app is running. Nothing is lost. You can switch this agent to run on any available engine in its settings.'
    : 'Any of your engines can take it — one being busy or at its usage limit does not block the others. It starts as soon as one picks it up, and nothing is lost. If it keeps waiting, check that the Implexa app is running and your Mac is awake.';

  return { headline, block: declared, detail };
}
