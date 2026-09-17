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

/**
 * Browser callers must prove both halves of the enqueue boundary: the HTTP
 * exchange succeeded and the response names the row that was durably inserted.
 * Keeping this in one helper prevents a new revise surface from treating a
 * 502 body (or a hollow 200) as a permanent agent update.
 */
export function confirmedAgentRevisionRequestId(httpOk: boolean, value: unknown): string | null {
  return httpOk ? confirmedRunRequestId(value) : null;
}

/** One submit boundary for every permanent-agent-edit form. */
export function canSubmitAgentRevision(input: {
  statusUnavailable: boolean;
  revisionPending: boolean;
  busy: boolean;
  note: string;
}): boolean {
  return !input.statusUnavailable && !input.revisionPending && !input.busy && input.note.trim().length > 0;
}
