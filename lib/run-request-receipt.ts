/**
 * A successful HTTP exchange is not proof that a queue row exists.  Only this
 * exact receipt authorizes optimistic Queued UI, clearing per-run inputs, or a
 * redirect to Active Agents.
 */
export function confirmedRunRequestId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as { ok?: unknown; request?: { id?: unknown } | null };
  return body.ok === true && typeof body.request?.id === 'string' && body.request.id.trim().length > 0
    ? body.request.id : null;
}
