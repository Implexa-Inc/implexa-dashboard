import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {render} from '../../../../lib/test/render.ts';
const U=(n:number)=>`24000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const VERSION=U(1),RECORD=U(2),DIGEST='a'.repeat(64);
const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmO0AAAAASUVORK5CYII=';
const bytes=Buffer.from(IMAGE.slice(22),'base64'),SHA=createHash('sha256').update(bytes).digest('hex');
const projection={recordId:RECORD,recordDigest:DIGEST,relation:'accepted',properties:['layout_variety'],summary:'Explain the relationship visually.',mustNotCopy:['source labels'],attribution:null,
 derivative:{evidenceId:U(3),sha256:SHA,anchorDigest:'b'.repeat(64),mediaType:'image/png',sizeBytes:bytes.length,width:1,height:1}};
const stored={storageId:U(4),recordId:RECORD,recordDigest:DIGEST,evidenceId:U(3),sha256:SHA,sizeBytes:bytes.length,width:1,height:1,
 consentReceiptDigest:'c'.repeat(64),retentionUntil:'2030-01-01T00:00:00Z',storedAt:'2026-10-28T00:00:00Z',uploadExpiresAt:null,withdrawnAt:null,deletedAt:null};
const item={recordId:RECORD,recordDigest:DIGEST,sessionId:U(5),localSourceId:U(6),baseVersionId:U(7),sourceMachineId:'publisher-machine',projection,
 decision:{chosen:'Spatial comparison',why:'Explains the relationship',process:'Use a fresh visual',desiredBehavior:'Adapt to new content'},eligible:true,storage:stored,release:null as any};
async function setup(mode='valid'){
 const calls:Array<{kind:string;body:any}>=[];let live=structuredClone(item);
 const bridge={trainingEvidenceStorageContractVersion:'1',trainingLocal:async(kind:string,args:any)=>{
  calls.push({kind,body:args});return kind==='list'?{ok:true,sources:[{sourceId:U(6),token:U(8),decisions:[{recordId:RECORD,recordDigest:DIGEST}]}]}
   :kind==='decisionPreview'?{ok:true,recordId:RECORD,recordDigest:DIGEST,image:mode==='wrong-image'?IMAGE.replace('mO0','nO0'):IMAGE}:{ok:false};}};
 const r=await render('../training/[slug]/publisher-teaching-release.tsx',{slug:'video-agent',versionId:VERSION},{bridge});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 r.window.fetch=(async(_url:any,opts:any={})=>{const body=opts.body?JSON.parse(opts.body):null;calls.push({kind:opts.method||'GET',body});
  const common={ok:true,contractVersion:'publisher-teaching-preview.v1',releaseId:body?.releaseId,releaseDigest:'d'.repeat(64),projection,
   receipt:{workflowVersionId:VERSION,storageId:U(4),retentionUntil:stored.retentionUntil,deliveryMode:'on_question'}};
  if(!body)return {ok:mode!=='foreign',json:async()=>({ok:mode!=='foreign',reason:'not_owned',contractVersion:'publisher-teaching-candidates.v1',workflowVersionId:mode==='stale'?U(99):VERSION,candidates:[live]})};
  if(body.action==='release'){live={...live,release:{releaseId:body.releaseId,releaseDigest:common.releaseDigest,withdrawnAt:null,current:true}};return {ok:true,json:async()=>({...common,released:true})};}
  if(body.action==='withdraw'){live={...live,release:{...live.release,withdrawnAt:'2026-10-28T00:00:01Z',current:false}};return {ok:true,json:async()=>({ok:true,...live.release})};}
  return {ok:true,json:async()=>({...common,released:false})};
 }) as typeof r.window.fetch;
 return {r,calls};
}
test('customer release previews the exact old-session frame, requires separate consent, and can be withdrawn',async()=>{
 const {r,calls}=await setup();try{
  await r.click(r.getByText('Load compatible teaching candidates'));await r.click(r.getByText(`Review teaching ${DIGEST.slice(0,8)}`));
  assert.ok(r.document.querySelector('img'));assert.equal(calls.find(c=>c.kind==='list')?.body.sessionId,U(5),'uses the actual original session, not active training session');
  await r.click(r.getByText('Prepare exact release preview'));
  assert.equal((r.getByText('Release this exact teaching') as HTMLButtonElement).disabled,true);assert.equal(calls.some(c=>c.body?.action==='release'),false);
  await r.click(r.getByText(/I reviewed this exact image and guidance/).closest('label')!.querySelector('input')!);
  await r.click(r.getByText('Release this exact teaching'));
  const submitted=calls.find(c=>c.body?.action==='release')!.body;assert.equal(submitted.previewDigest,'d'.repeat(64));assert.equal(submitted.storageId,U(4));assert.equal(submitted.versionId,VERSION);
  assert.equal(Object.hasOwn(submitted,'ownerId'),false);assert.match(r.text(),/Released for this version/);
  await r.click(r.getByText(`Withdraw release ${DIGEST.slice(0,8)}`));assert.match(r.text(),/Further customer disclosure is withdrawn/);
  assert.equal(calls.some(c=>['accept','annotate','revoke','serverStorage'].includes(c.kind)),false,'release never rewrites or deletes the admitted teaching');
 }finally{r.cleanup();}
});
test('stale version, foreign candidates and mismatched frame never reach release preparation',async()=>{
 for(const mode of ['stale','foreign','wrong-image']){const {r,calls}=await setup(mode);try{
  await r.click(r.getByText('Load compatible teaching candidates'));
  if(mode==='wrong-image')await r.click(r.getByText(`Review teaching ${DIGEST.slice(0,8)}`));
  assert.equal(r.queryByText('Prepare exact release preview'),null,mode);assert.equal(calls.some(c=>c.body?.action==='preview'||c.body?.action==='release'),false,mode);
 }finally{r.cleanup();}}
});
