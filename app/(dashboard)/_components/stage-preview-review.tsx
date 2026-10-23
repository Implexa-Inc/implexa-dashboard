'use client';

// Existing Preview modal/tokens plus the separate session-authenticated owner
// action. The worker never receives the session or approval bridge.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Modal from './modal';
import { approveStagePreview, reviseStagePreview, desktopReviewHref, parseStagePreviewView, requestStagePreview, revokePreview,
  stagePreviewTokens, type StagePreviewSummary, type StagePreviewView } from '@/lib/review-preview';

export default function StagePreviewReview({ summary }: { summary: StagePreviewSummary }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<StagePreviewView | null>(null);
  const [mediaFailure, setMediaFailure] = useState(false);
  const [message, setMessage] = useState('Loading the preserved Preview evidence…');
  const inFlight=useRef(false),[approving,setApproving]=useState(false),[decisionMessage,setDecisionMessage]=useState<string|null>(null),
    [continuationId,setContinuationId]=useState<string|null>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let tokens: string[] = [];
    setView(null); setMediaFailure(false); setMessage('Loading the preserved Preview evidence…');setDecisionMessage(null);
    void requestStagePreview(summary.runId, summary.preparationId).then(result => {
      tokens = stagePreviewTokens(result);
      if (!active) { tokens.forEach(t => void revokePreview(t)); return; }
      const decoded = parseStagePreviewView(result, summary);
      if (!decoded) {
        tokens.forEach(t => void revokePreview(t)); tokens = [];
        const error = (result as { error?: string } | null)?.error;
        setMessage(error === 'desktop_required' ? 'Open this run in Implexa Desktop on the machine that ran Preview.'
          : error === 'update_required' ? 'Update Implexa Desktop to inspect this Preview.'
          : error === 'scene_preview_wrong_machine' ? 'These preserved files are on the machine that ran Preview. Open this run there.'
          : 'The preserved Preview could not be verified here. This does not mean its files are gone.');
      } else setView(decoded);
    });
    return () => { active = false; tokens.forEach(t => void revokePreview(t)); };
  }, [open, summary]);
  async function approve(revision=false){
    const digest=revision?view?.revisionDecisionDigest:view?.decisionDigest;
    if(inFlight.current||!digest||mediaFailure||continuationId)return;
    inFlight.current=true;setApproving(true);setDecisionMessage(null);
    try{
      const {data:{session}}=await createClient().auth.getSession();
      if(!session?.access_token)throw Error('session');
      // One click, one invocation. The bearer is never stored in component
      // state, receipts or worker context. Main and the backend recheck it.
      const result=await (revision?reviseStagePreview:approveStagePreview)(summary.runId,summary.preparationId,digest,session.access_token) as {
        ok?:boolean;continuationRequestId?:string;error?:string};
      if(result?.ok!==true||!result.continuationRequestId||!/^[a-f0-9-]{36}$/i.test(result.continuationRequestId)){
        if(result?.error==='scene_preview_runtime_changed_after_approval')setDecisionMessage('Desktop’s renderer changed after Preview; review a fresh Preview before approving Master.');
        else if(result?.error==='scene_preview_owner_session_required'||result?.error==='scene_preview_owner_session_mismatch')setDecisionMessage('Sign in again with the owner account before approving this Preview.');
        else setDecisionMessage('Approval was not confirmed. Reopen this Preview to read its current state; do not start a separate run.');
        return;
      }
      setContinuationId(result.continuationRequestId);setDecisionMessage(revision
        ?'Compose correction is queued from the preserved scene and visual findings. Compose and Preview must pass fresh reviews; Master is not approved. No new media spending.'
        :'This exact Preview was approved. Master is queued on the same run; this is not video delivery or new media spending.');
    }catch{setDecisionMessage('The owner session could not be verified. Sign in again; no approval is confirmed here.');}
    finally{inFlight.current=false;setApproving(false);}
  }
  return <>
    <button className="btn-outline px-4 py-2 text-sm" type="button" onClick={() => setOpen(true)}>Inspect Preview</button>
    <Modal open={open} onClose={close} title="Preview evidence" maxWidth="max-w-5xl"
      subtitle="Preserved Preview evidence. Owner approval is a separate action below; this is not delivered video.">
      <p className="mb-4 text-sm text-ink-300">{summary.reviewState === 'incomplete'
        ? 'This review is incomplete; completed batches are evidence, not an overall verdict.'
        : summary.reviewState === 'fail' ? 'Preview failed. When the retained scene and correction allowance are verified, you can send these findings back to Compose below. Master is not available from this review.'
        : `Visual Judge result: ${summary.reviewState}. ${['passed','not_applicable'].includes(view?.temporalQa?.status || '')
          ? 'The exact owner decision is still required before Master.'
          : 'All-eight temporal QA and the exact owner decision are still required before Master.'}`}</p>
      {!view && <p role="status" className="text-sm text-ink-300">{message}</p>}
      {!view && <a className="mt-3 inline-flex text-sm underline" href={desktopReviewHref(summary.runId) || undefined}>Open this run in Implexa Desktop</a>}
      {view && <>
        {view.temporalQa && <section className="mb-4 text-sm text-ink-300" aria-label="Temporal QA">
          {['unavailable','not_applicable'].includes(view.temporalQa.status)
            ? <p>{view.temporalQa.status === 'unavailable' ? 'Temporal QA is unavailable; no measured pass is claimed.'
              : 'Provider-slot temporal QA is not applicable; there are no provider slots.'}</p>
            : <>
              <p>Temporal QA passed for {view.temporalQa.passedSlotCount}/{view.temporalQa.slotCount} slots;
                {' '}offset index proven on {view.temporalQa.offsetIndexProvenSlotCount}/{view.temporalQa.slotCount};
                {' '}{view.temporalQa.notVisuallyResolvableSlotCount}/{view.temporalQa.slotCount} not visually resolvable.</p>
              {view.temporalQa.status === 'failed' && <p>Rendered provider frames or narration did not correspond to the sealed sources within the frozen tolerance. This is a renderer/runtime/source issue, not a Compose creative finding. Master is not available; no automatic retry or new media spending is authorized.</p>}
              {view.temporalQa.status === 'not_assessable' && <p>Temporal correspondence could not be assessed: insufficient provider visibility or an audio window too short for the fixed measurement. This is not a Compose semantic finding. Master is not available; no automatic retry or new media spending is authorized.</p>}
              {view.temporalQa.slots.map(s => <p key={`${s.sceneId}:${s.slotId}`}>
                {s.sceneId} / {s.slotId}: {s.verdict}; {s.offsetEvidence === 'not_visually_resolvable'
                  ? 'offset not visually resolvable within ±2 source frames'
                  : s.verdict === 'passed' ? 'offset index proven within the measured ±2-source-frame comparison'
                  : 'informative comparison; no passing offset proof'}.
              </p>)}
            </>}
        </section>}
        {mediaFailure && <p role="alert" className="mb-3 text-sm text-amber-200">A Preview file could not be verified for display. Close and reopen this view to check the retained evidence again; this does not mean its files are gone.</p>}
        {view.criteria.map(c => <section key={c.id} className="mb-3 text-sm">
          <h3 className="font-semibold text-ink-100">{c.statement}</h3>
          {view.judgments.filter(j => j.criterionId === c.id).map((j, i) => <p key={i} className="text-ink-300">
            {j.verdict === 'not_applicable' ? j.reason : `${j.verdict}: ${j.reason}`} {j.frameIds.length > 0 && `Frames: ${j.frameIds.join(', ')}`}
          </p>)}
        </section>)}
        <div className="grid gap-4 md:grid-cols-2">{view.items.map(item => <figure key={item.id}>
          {item.kind === 'provider_window'
            ? <video controls preload="metadata" src={item.url} onError={() => setMediaFailure(true)} className="w-full" />
            // These are Desktop-only token URLs, not remote Next/Image sources.
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={item.url} alt={`Preview ${item.id}`} onError={() => setMediaFailure(true)} className="w-full" loading="lazy" />}
          <figcaption className="mt-1 text-xs text-ink-400">{item.kind}: {item.id}</figcaption>
        </figure>)}</div>
        {view.items.length === 0 && <p className="text-sm text-ink-300">No rendered media was retained for this incomplete review.</p>}
        {view.reviewState==='fail'&&summary.ownerHoldReady&&view.revisionDecisionDigest&&!continuationId&&<section className="mt-5 border-t border-ink-700 pt-4">
          <p className="mb-3 text-sm text-ink-300">Return the exact preserved scene and these visual findings to Compose. Stages 1–3 stay unchanged. This uses one shared continuation slot and requires fresh Compose and Preview reviews. It does not approve Master or new media purchases.</p>
          <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={approving||mediaFailure} onClick={()=>void approve(true)}>
            {approving?'Rechecking revision…':'Send findings back to Compose'}</button>
        </section>}
        {view.reviewState==='pass'&&summary.ownerHoldReady&&view.decisionDigest&&!continuationId&&<section className="mt-5 border-t border-ink-700 pt-4">
          <p className="mb-3 text-sm text-ink-300">Approve only the Preview shown here, including its temporal uncertainty above. Master must reverify the same sources and renderer. No new media purchase is authorized.</p>
          <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={approving||mediaFailure} onClick={()=>void approve()}>
            {approving?'Rechecking and approving…':'Approve this Preview and continue to Master'}</button>
        </section>}
        {decisionMessage&&<p role="status" className="mt-3 text-sm text-ink-300">{decisionMessage}</p>}
      </>}
    </Modal>
  </>;
}
