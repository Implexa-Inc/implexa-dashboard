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
    const supabase=createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return respond({ ok: false, reason: 'unauthorized' }, 401);
    const query = new URL(request.url).searchParams;
    const slug = query.get('slug'), issueId=query.get('issueId');let runId=query.get('runId');
    if ([...query.keys()].some(key => !['slug', 'runId','issueId'].includes(key))
      || query.getAll('slug').length !== 1 || (query.getAll('runId').length+query.getAll('issueId').length)!==1
      || !/^[a-zA-Z0-9_-]{1,200}$/.test(slug || '') || !UUID.test(runId||issueId||'')) {
      return respond({ ok: false, reason: 'invalid_request' }, 400);
    }
    if(issueId){
      // The authenticated RLS client may read only its own marks. The canonical
      // Review Room reader and owned-agent check below remain the second gate.
      const found=await supabase.from('run_review_issues').select('run_id').eq('id',issueId).eq('purpose','training').neq('status','dismissed').abortSignal(AbortSignal.any([request.signal,AbortSignal.timeout(3000)])).maybeSingle();
      if(found.error)return respond({ok:false,reason:'training_review_unavailable'},503);
      if(!UUID.test(found.data?.run_id||''))return respond({ok:false,reason:'training_review_not_found'},404);
      runId=found.data!.run_id;
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
    if(issueId&&!packet.issues.some(issue=>issue.id===issueId&&issue.purpose==='training'&&issue.status!=='dismissed'))return respond({ok:false,reason:'training_review_not_found'},404);
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
