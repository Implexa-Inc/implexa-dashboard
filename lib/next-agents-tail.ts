/**
 * The recommendation engine appends a "## Next agents to build" markdown TAIL to a
 * run's output_markdown so the ideas travel to email/Telegram/Slack
 * (agent-recommendation.service). In the DASHBOARD that tail is redundant AND
 * misleading — <NextAgentCards> renders the SAME ideas with working "Build it"
 * buttons, so the prose copy reads as a dead list you can't act on. RunMarkdown
 * strips it from the RENDERED markdown only; the stored output keeps the tail for
 * delivery.
 *
 * Cuts from the LAST such heading to the end (it's an appended tail), so a real
 * deliverable that merely mentions the phrase earlier is untouched. Pure + safe on
 * empty/nullish input.
 */
export function stripNextAgentsTail(md: string): string {
  const s = String(md || '');
  const re = /(^|\n)#{1,6}[ \t]*Next agents to build[ \t]*(?:\n|$)/gi;
  let cut = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) cut = m.index + (m[1] ? 1 : 0); // index of the leading '#'
  if (cut < 0) return s;
  return `${s.slice(0, cut).replace(/\s+$/, '')}\n`;
}
