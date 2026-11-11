import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';

test('disabled image annotation also prevents starting a voice capture',async()=>{
 const calls:any[]=[],r=await render('../training/[slug]/training-image-player.tsx',{ownerId:'11111111-1111-4111-8111-111111111111',sourceId:'source',image:'data:image/png;base64,aW1hZ2U=',timeMs:0,text:'',disabled:true,onChange:()=>{},onDone:()=>{}},{bridge:{trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{calls.push({op,args});return {ok:false};}}});
 try{const button=[...r.document.querySelectorAll('button')].find(button=>button.textContent?.includes('Add a voice note'))!;assert.equal(button.disabled,true);await r.click(button);assert.equal(calls.length,0);}finally{r.cleanup();}
});
