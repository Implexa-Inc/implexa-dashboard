import type { SupabaseClient } from '@supabase/supabase-js';

/** A retry keeps the request id and original creation time. Its owner-readable
 * successful requeue event fixes the new generation's age. Process restarts,
 * heartbeats, claims and reservations never refresh this display deadline. */
export async function readJudgeReviewAge(
  supabase: SupabaseClient,
  ownerId: string,
  request: { id?: string; created_at: string | null; bootstrap_retry_epoch?: number | string | null },
): Promise<string | null> {
  const rawEpoch = request.bootstrap_retry_epoch;
  if (rawEpoch === 0 || rawEpoch === '0') return request.created_at;
  const epoch = typeof rawEpoch === 'string' && /^[1-9]\d*$/.test(rawEpoch) ? Number(rawEpoch) : rawEpoch;
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1 || !request.id) {
    throw new Error('judge_review_age_unavailable');
  }
  const { data, error } = await supabase.from('run_request_events').select('at, attempt')
    .eq('request_id', request.id).eq('user_id', ownerId).eq('event', 'queued').eq('actor', 'control_plane_retry')
    .order('attempt', { ascending: false }).limit(epoch + 1);
  if (error || !Array.isArray(data) || data.length !== epoch) throw new Error('judge_review_age_unavailable');
  const created = request.created_at ? Date.parse(request.created_at) : NaN;
  const now = Date.now();
  if (!Number.isFinite(created)) throw new Error('judge_review_age_unavailable');
  let newerAttempt = Infinity, newerTime = Infinity;
  for (const event of data) {
    const queued = typeof event.at === 'string' ? Date.parse(event.at) : NaN;
    if (!Number.isSafeInteger(event.attempt) || event.attempt < 1 || event.attempt >= newerAttempt
      || !Number.isFinite(queued) || queued < created || queued > now || queued > newerTime) {
      throw new Error('judge_review_age_unavailable');
    }
    newerAttempt = event.attempt; newerTime = queued;
  }
  return data[0].at;
}

export type JudgeRepairPhase = 'none' | 'limit_reached' | 'queued' | 'running' | 'completed' | 'queue_failed';

export function judgeRepairState({
  verdict, repairRound = 0, requestStatus = null, requestRunId = null,
  currentRunId = null, maxRounds = 2,
}: {
  verdict?: string | null;
  repairRound?: number | null;
  requestStatus?: string | null;
  requestRunId?: string | null;
  currentRunId?: string | null;
  maxRounds?: number;
}): { phase: JudgeRepairPhase; nextRound: number; repairedRunId: string | null } {
  const round = typeof repairRound === 'number' && Number.isFinite(repairRound) ? Math.max(0, repairRound) : 0;
  if (verdict !== 'repair') return { phase: 'none', nextRound: round, repairedRunId: null };
  if (round >= maxRounds) return { phase: 'limit_reached', nextRound: round, repairedRunId: null };
  if (requestStatus === 'pending') return { phase: 'queued', nextRound: round + 1, repairedRunId: null };
  if (requestStatus === 'consumed') return { phase: 'running', nextRound: round + 1, repairedRunId: null };
  if (requestStatus === 'done' && requestRunId && requestRunId !== currentRunId) {
    return { phase: 'completed', nextRound: round + 1, repairedRunId: requestRunId };
  }
  return { phase: 'queue_failed', nextRound: round + 1, repairedRunId: null };
}
