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
