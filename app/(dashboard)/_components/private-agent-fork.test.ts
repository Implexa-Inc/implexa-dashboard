import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';
test('private fork uses a stable request identity and never requests an automatic run',async()=>{
 const version='45000000-0000-4000-8000-000000000001',lineage='45000000-0000-4000-8000-000000000002';
 const r=await render('../../s/run/[token]/fork-run-cta.tsx',{skillSlug:'parent-agent',source:'generated',versionId:version},{backend:()=>({ok:true,forkedSlug:'private-child',lineageId:lineage})});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 try{await r.act(()=>Promise.resolve());await r.click(r.getByText('Make a private fork'));
  const call=r.calls.backend[0] as any;assert.equal(call.path,'/api/v2/me/fork-agent');assert.equal(call.init.body.expectedVersionId,version);assert.equal(Object.hasOwn(call.init.body,'autoRun'),false);assert.match(call.init.body.mutationId,/^[a-f0-9-]{36}$/);
  assert.equal(r.calls.backend.length,1);assert.equal(r.calls.push.length,0);assert.match(r.text(),/no permissions or private customer preferences were copied/i);
  assert.equal(r.getByText('Open private fork').getAttribute('href'),'/workflows/private-child?source=generated');
 }finally{r.cleanup();}
});
