import type { SupabaseClient } from '@supabase/supabase-js';

export type HumanReview = 'not_recorded' | 'accepted' | 'changes_requested' | 'unavailable';
export type AttemptHumanReview = Exclude<HumanReview, 'not_recorded'> | 'not_associated';
export const humanReviewLabels = {
  not_recorded: 'not recorded', accepted: 'accepted', changes_requested: 'changes requested', unavailable: 'unavailable',
} as const;

function decision(value: unknown): Exclude<HumanReview, 'not_recorded'> {
  return value === 'accepted' ? 'accepted' : value === 'requested_changes' ? 'changes_requested' : 'unavailable';
}

// Human review is independent of delivery/Judge status. An attempt claim needs its persisted association.
export async function readHumanReview(client: Pick<SupabaseClient, 'from'>, ownerId: string, runId: string, contextId: string) {
  const runReview = async (): Promise<HumanReview> => {
    try {
      const result = await client.from('run_acceptance_events').select('decision')
        .eq('user_id', ownerId).eq('run_id', runId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      return result.error ? 'unavailable' : result.data ? decision(result.data.decision) : 'not_recorded';
    } catch { return 'unavailable'; }
  };
  const attemptReview = async (): Promise<AttemptHumanReview> => {
    try {
      const association = await client.from('run_learning_outcome_associations').select('acceptance_event_id')
        .eq('owner_id', ownerId).eq('attempt_context_id', contextId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (association.error) return 'unavailable';
      if (!association.data) return 'not_associated';
      if (typeof association.data.acceptance_event_id !== 'string') return 'unavailable';
      const result = await client.from('run_acceptance_events').select('decision')
        .eq('id', association.data.acceptance_event_id).eq('user_id', ownerId).eq('run_id', runId).maybeSingle();
      return result.error || !result.data ? 'unavailable' : decision(result.data.decision);
    } catch { return 'unavailable'; }
  };
  const [humanReview, associatedHumanReview] = await Promise.all([runReview(), attemptReview()]);
  return { humanReview, associatedHumanReview };
}
