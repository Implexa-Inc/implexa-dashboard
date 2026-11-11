import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getReviewPacket } from '@/lib/review';
import { readMyWorkflows } from '@/lib/workflow-catalog';
import { trainingReviewSlug } from '@/lib/training-review-routing';
import { UUID } from '@/lib/trainer-questions';

export const dynamic = 'force-dynamic';

/** Read the existing Review Room packet for an owned agent's embedded Training player.
 * This is presentation over the canonical review reader, not a new feedback writer.
 */
export async function GET(request: Request) {
  const respond = (value: unknown, status = 200) => NextResponse.json(value, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
  try {
    const { data: { session } } = await createClient().auth.getSession();
    if (!session?.access_token) return respond({ ok: false, reason: 'unauthorized' }, 401);
    const query = new URL(request.url).searchParams;
    const slug = query.get('slug'), runId = query.get('runId');
    if ([...query.keys()].some(key => !['slug', 'runId'].includes(key))
      || query.getAll('slug').length !== 1 || query.getAll('runId').length !== 1
      || !/^[a-zA-Z0-9_-]{1,200}$/.test(slug || '') || !UUID.test(runId || '')) {
      return respond({ ok: false, reason: 'invalid_request' }, 400);
    }
    const [packet, owned] = await Promise.all([getReviewPacket(runId!), readMyWorkflows(session.access_token)]);
    if (owned.status !== 'ready') return respond({ ok: false, reason: 'training_review_unavailable' }, 503);
    if (!packet.live || !packet.run) {
      return respond({ ok: false, reason: packet.httpStatus === 404 || packet.httpStatus === 403
        ? 'training_review_not_found' : 'training_review_unavailable' },
      packet.httpStatus === 404 || packet.httpStatus === 403 ? 404 : 503);
    }
    // Same scope rule as the existing Training review page. Customer reviews and
    // approval-before-action holds retain their existing review route.
    if (trainingReviewSlug(packet, owned) !== slug) {
      return respond({ ok: false, reason: 'training_review_not_found' }, 404);
    }
    const versions = packet.lineage.versions;
    return respond({ ok: true, contractVersion: 'training-run-review.v1', review: {
      trainingSlug: slug, runId: packet.run.id, agentSlug: packet.run.slug,
      agentName: owned.workflows.find(agent => agent.slug === slug && agent.source === 'generated')!.name,
      artifacts: packet.artifacts, historicalCandidates: packet.historicalCandidates,
      production: packet.production, issues: packet.issues, session: packet.session,
      reviewArtifacts: packet.reviewArtifacts, sources: packet.sources, isApprovalHold: false,
      versions, currentVersionLabel: versions.find(version => version.runId === packet.run!.id)?.label ?? null,
    } });
  } catch {
    return respond({ ok: false, reason: 'training_review_unavailable' }, 503);
  }
}
