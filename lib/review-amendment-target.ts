import type { SupabaseClient } from '@supabase/supabase-js';

export type ReviewAmendmentTarget = { state: 'ready'; href: string } | { state: 'unavailable' } | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Navigation only. The Review service still authorizes opening/submitting a round.
 * Never pick the newest same-agent run: the exact child request must name the
 * owner-scoped session on this child's recorded parent.
 */
export async function loadReviewAmendmentTarget(
  db: Pick<SupabaseClient, 'from'>, ownerId: string, runId: string, parentRunId: string | null,
): Promise<ReviewAmendmentTarget> {
  if (!parentRunId) return null;
  const unavailable = { state: 'unavailable' } as const;
  if (![ownerId, runId, parentRunId].every(id => UUID.test(id))) return unavailable;
  try {
    const requests = await db.from('run_requests')
      .select('id,user_id,organization_id,run_id,kind,source,origin_review_session_id')
      .eq('user_id', ownerId).eq('run_id', runId).eq('kind', 'continue').eq('source', 'review_room').limit(2);
    if (requests.error || !Array.isArray(requests.data)) return unavailable;
    if (requests.data.length === 0) return null;
    if (requests.data.length !== 1) return unavailable;
    const request = requests.data[0];
    if (request.user_id !== ownerId || request.run_id !== runId || request.kind !== 'continue'
      || request.source !== 'review_room' || !UUID.test(request.origin_review_session_id || '')) return unavailable;
    const sessions = await db.from('run_review_sessions')
      .select('id,user_id,organization_id,run_id,selected_artifact_id')
      .eq('id', request.origin_review_session_id).eq('user_id', ownerId).limit(2);
    if (sessions.error || !Array.isArray(sessions.data) || sessions.data.length !== 1) return unavailable;
    const session = sessions.data[0];
    if (session.id !== request.origin_review_session_id || session.user_id !== ownerId
      || session.organization_id !== request.organization_id || session.run_id !== parentRunId
      || (session.selected_artifact_id != null && !UUID.test(session.selected_artifact_id))) return unavailable;
    return { state: 'ready', href: `/review/${session.run_id}${session.selected_artifact_id
      ? `?artifact=${session.selected_artifact_id}` : ''}` };
  } catch { return unavailable; }
}
