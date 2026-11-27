import test from 'node:test';
import assert from 'node:assert/strict';
import {render,type Rendered} from '../../../lib/test/render.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,OWNER=id(1),H='a'.repeat(64);
const turn=(n:number,patch:any={})=>({turnId:id(n),message:'Create a presenter video editor.',baseReplyId:null,createdAt:'2026-10-31T12:00:00Z',status:'answered',
 replyId:id(n+100),replyDigest:H,reply:'Prepared; nothing has started.',brief:{name:'Video studio',goal:'Edit presenter footage.',inputs:['One raw video'],outputs:['Playable MP4'],tools:[{name:'Remotion',requirement:'required'}]},
 trainingNotes:['Prefer warm, quiet layouts.'],questions:[],buildIntent:'Edit presenter footage. Deliver MP4.',toolPreferences:['remotion'],tools:[{name:'Remotion',requirement:'required',supported:true}],model:'claude-haiku-5-5',reason:null,...patch});
async function type(r:Rendered,s:string){const e=r.document.querySelector('textarea')!;await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(e,s);e.dispatchEvent(new r.window.Event('input',{bubbles:true}));});}
async function setup(t:any,initial:any[]=[],bridge?:Record<string,unknown>){
 let turns=initial;const calls:any[]=[];let draftId='';
 const r=await render('./guided-agent-creation.tsx',{ownerId:OWNER},{bridge,webCrypto:globalThis.crypto,fetch:(async(url:string,init:any={})=>{
  calls.push({url,init});
  if(url==='/api/agents/plan-preview')return {ok:true,json:async()=>({ok:true,decisionMode:'direct',autoToolPreferences:['ffmpeg'],disclosures:[]})};
  if(url==='/api/agents/create')return {ok:true,json:async()=>({ok:true,request:{id:id(99)}})};
  if(init.method==='POST'){const b=JSON.parse(init.body);draftId=b.draftId;turns=[...turns,turn(turns.length+2,{turnId:b.turnId,message:b.message,baseReplyId:b.baseReplyId})];}
  else draftId=new URL(url,'https://test.invalid').searchParams.get('draftId')!;
  return {ok:true,json:async()=>({ok:true,contractVersion:'agent-creation-brief.v1',draftId,turns,totalTurns:turns.length,buildRequestId:null})};
 }) as typeof fetch});t.after(()=>r.cleanup());return {r,calls};
}
test('creation opens with one blank chat, restores saved cards by GET and starts nothing',async t=>{
 const {r,calls}=await setup(t,[turn(2)]);assert.equal(r.document.querySelectorAll('textarea').length,1);assert.equal(r.document.querySelectorAll('input:not([type=hidden]):not([hidden])').length,0);
 assert.match(r.text(),/One raw video/);assert.match(r.text(),/Playable MP4/);assert.match(r.text(),/have not been admitted as learnings/);
 assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined);
 await r.click(r.getByText('Refresh saved draft'));assert.equal(calls.length,2);assert.equal(calls.some(c=>c.init.method==='POST'),false);
});
test('Send preserves words and exact selected base; edits and Undo never build or call another provider',async t=>{
 const {r,calls}=await setup(t,[turn(2)]);await type(r,'  Keep the task, but prefer FFmpeg.  ');await r.click(r.getByText('Send'));
 const posts=calls.filter(c=>c.url==='/api/agents/creation-draft'&&c.init.method==='POST');assert.equal(posts.length,1);
 const b=JSON.parse(posts[0].init.body);assert.equal(b.message,'  Keep the task, but prefer FFmpeg.  ');assert.equal(b.baseReplyId,id(102));assert.equal(b.consent,true);
 await r.click(r.getByText('Undo last change'));assert.match(r.text(),/Previous saved draft restored/);assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
 assert.equal(calls.some(c=>c.url==='/api/agents/create'),false);
});
test('explicit Build passes only the chosen private-source reference and public intent through the existing gate',async t=>{
 const {r,calls}=await setup(t,[turn(2)]);await r.click(r.getByText('Build this agent'));
 await r.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
 const creates=calls.filter(c=>c.url==='/api/agents/create');assert.equal(creates.length,1);
 const body=JSON.parse(creates[0].init.body);assert.deepEqual(body.creationDraftBinding,{draftId:new URL(calls[0].url,'https://test.invalid').searchParams.get('draftId'),replyId:id(102),replyDigest:H});
 assert.equal(body.intent,'');assert.deepEqual(body.creationDraftFiles,[]);assert.equal(body.toolPreferences,undefined);assert.doesNotMatch(JSON.stringify(body),/warm, quiet|trainingNotes/);
 assert.match(r.text(),/Connect Claude or Codex in Setup to build it/);assert.equal(r.getByText('Connect Claude or Codex').getAttribute('href'),'/install');
});
test('a pending durable reply prevents duplicate Send and Build, but can still be read',async t=>{
 const {r,calls}=await setup(t,[turn(2),turn(3,{status:'pending',replyId:null,replyDigest:null,reply:null,brief:null,model:null,trainingNotes:[],questions:[],buildIntent:null,tools:[],toolPreferences:[]})]);
 assert.equal((r.getByText('Build this agent') as HTMLButtonElement).disabled,true);assert.equal(r.document.querySelector('textarea')!.disabled,true);
 await r.click(r.getByText('Refresh saved draft'));assert.equal(calls.length,2);assert.equal(calls.some(c=>c.init.method==='POST'),false);
});
test('Undo from a new branch selects its actual base, not the abandoned preceding list item',async t=>{
 const {r,calls}=await setup(t,[turn(2),turn(3,{baseReplyId:id(102),message:'Abandoned branch'}),turn(4,{baseReplyId:id(102),message:'Current branch'})]);
 await r.click(r.getByText('Undo last change'));await type(r,'Revise the restored draft.');await r.click(r.getByText('Send'));
 const post=calls.find(c=>c.url==='/api/agents/creation-draft'&&c.init.method==='POST');assert.equal(JSON.parse(post.init.body).baseReplyId,id(102));
});


test('a follow-up choice sends one answer and preserves the unsent composer draft',async t=>{
 const q=turn(3,{brief:null,questions:['Which campaign goal should this agent use?'],answerOptions:['Ask at the start of each run','Optimize for app installs'],reply:'The account choices are saved.',buildIntent:null,trainingNotes:[],tools:[],toolPreferences:[]});
 const {r,calls}=await setup(t,[turn(2),q]);
 assert.equal(r.queryByText('Build this agent'),null);
 assert.equal(r.queryByText('Recommend tools'),null);assert.equal(r.getByText('Type manually').previousElementSibling?.textContent,'Optimize for app installs');
 await type(r,'An unsent follow-up.');
 await r.click(r.getByText('Type manually'));
 assert.equal(r.document.activeElement,r.document.querySelector('textarea'));
 assert.equal(calls.some(c=>c.init.method==='POST'),false);
 await r.click(r.getByText('Ask at the start of each run (Recommended)'));
 const posts=calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,1);
 const body=JSON.parse(posts[0].init.body);
 assert.equal(body.message,'Ask at the start of each run');assert.equal(body.baseReplyId,q.replyId);
 assert.equal(r.document.querySelector('textarea')!.value,'An unsent follow-up.');
 assert.equal(calls.some(c=>c.url==='/api/agents/create'),false);
});

test('an unsupported document leaves the typed draft editable and sends nothing',async t=>{
 const {r,calls}=await setup(t);
 assert.equal(r.document.querySelector('input[type=checkbox]'),null);
 await type(r,'Use this example');
 const picker=r.document.querySelector('input[type=file]')!;
 await r.act(()=>{
  Object.defineProperty(picker,'files',{value:[new r.window.File(['example'],'example.pdf')]});
  picker.dispatchEvent(new r.window.Event('change',{bubbles:true}));
 });
 assert.match(r.document.querySelector('[role=alert]')!.textContent!,/paste the relevant text/i);
 assert.equal(r.document.querySelector('textarea')!.value,'Use this example');
 assert.equal(calls.filter(c=>c.init.method==='POST').length,0);
});

test('the plus menu dismisses on Escape and opens the selected picker without sending',async t=>{
 let folderPicks=0;
 const {r,calls}=await setup(t,[],{pickFile:async()=>({canceled:true}),pickDirectory:async()=>{
  folderPicks++;return {ok:true,path:'/example/Footage'};
 }});
 const add=r.document.querySelector<HTMLButtonElement>('[aria-label="Add attachments"]')!;
 const options=r.document.querySelector<HTMLElement>('[aria-label="Attachment options"]')!;
 assert.equal(options.hidden,true);
 await r.click(add);assert.equal(options.hidden,false);
 await r.act(()=>{options.dispatchEvent(new r.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
 assert.equal(options.hidden,true);assert.equal(r.document.activeElement,add);
 await r.click(add);await r.click(r.getByText('Attach folder'));
 assert.equal(folderPicks,1);assert.equal(options.hidden,true);
 assert.ok(r.document.querySelector('[aria-label="Remove Footage"]'));
 assert.equal(calls.some(call=>call.init.method==='POST'),false);
});

test('a folder and a playbook use the same attachment menu and send only shareable context',async t=>{
 const {r,calls}=await setup(t,[],{pickDirectory:async()=>({ok:true,path:'/example/private/Footage'})});
 const add=r.document.querySelector('[aria-label="Add attachments"]')!;
 await r.click(add);
 const options=r.document.querySelector('[aria-label="Attachment options"]')!;
 assert.deepEqual(Array.from(options.querySelectorAll('button'),item=>item.textContent?.trim()),['Attach file','Attach folder']);
 await r.click(r.getByText('Attach folder'));
 const picker=r.document.querySelector('input[type=file]')!;
 await r.act(()=>{
  Object.defineProperty(picker,'files',{value:[new r.window.File(['Trim the introduction.'],'playbook.md')]});
  picker.dispatchEvent(new r.window.Event('change',{bubbles:true}));
 });
 await type(r,'Use the attached playbook.');
 await r.click(r.document.querySelector('[aria-label="Send message"]')!);
 for(let tries=0;tries<10&&!calls.some(call=>call.init.method==='POST');tries++){
  await r.act(()=>new Promise(resolve=>setTimeout(resolve,15)));
 }
 const post=calls.find(c=>c.url==='/api/agents/creation-draft'&&c.init.method==='POST');
 assert.ok(post,r.text());
 const {message}=JSON.parse(post.init.body);
 assert.match(message,/Use the attached playbook\./);
 assert.match(message,/Trim the introduction\./);
 assert.match(message,/names only.*Footage/);
 assert.doesNotMatch(message,/\/example\/private/);
});

const cue=(r:Rendered)=>r.document.querySelector('section[aria-label="Chat with AI"] [data-testid="chat-build-cue"]');
test('the chat itself says the plan is ready and builds the same selected draft as the cards',async t=>{
 const {r,calls}=await setup(t,[turn(2)]);const box=cue(r)!;assert.ok(box,'the build cue sits inside the chat');
 assert.match(box.textContent||'',/Your plan is ready\./);assert.match(box.textContent||'',/Review the plan, or keep chatting/);
 const button=box.querySelector('button')!;assert.equal(button.textContent,'Build this agent');
 assert.equal([...r.document.querySelectorAll('button')].filter(b=>b.textContent==='Build this agent').length,2,'the button under the cards stays');
 await r.click(button);await r.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
 const creates=calls.filter(c=>c.url==='/api/agents/create');assert.equal(creates.length,1);
 assert.deepEqual(JSON.parse(creates[0].init.body).creationDraftBinding,{draftId:new URL(calls[0].url,'https://test.invalid').searchParams.get('draftId'),replyId:id(102),replyDigest:H});
 assert.equal(cue(r),null,'the cue leaves once the build is queued');
});
test('the chat cue never claims readiness without a prepared draft, while a reply is pending, or for an older selection',async t=>{
 const none=await setup(t,[turn(2,{brief:null,questions:['Which goal?'],answerOptions:['A','B'],buildIntent:null,trainingNotes:[],tools:[],toolPreferences:[]})]);
 assert.equal(cue(none.r),null);
 const open=await setup(t,[turn(2,{questions:['Which pitch should be scripted?'],answerOptions:['Pitch 1','Pitch 2']})]);
 assert.match(cue(open.r)!.textContent||'',/You can build now, or answer first\..*uses the plan as it stands/);assert.doesNotMatch(cue(open.r)!.textContent||'',/plan is ready/);
 const pending=await setup(t,[turn(2),turn(3,{status:'pending',replyId:null,replyDigest:null,reply:null,brief:null,model:null,trainingNotes:[],questions:[],buildIntent:null,tools:[],toolPreferences:[]})]);
 assert.match(cue(pending.r)!.textContent||'',/Preparing your reply/);assert.equal(cue(pending.r)!.querySelector('button')!.disabled,true);
 const older=await setup(t,[turn(2),turn(3,{baseReplyId:id(102),message:'Make it shorter'})]);
 assert.match(cue(older.r)!.textContent||'',/Your plan is ready/);
 await older.r.click(older.r.getByText('Undo last change'));
 assert.match(cue(older.r)!.textContent||'',/This builds the earlier saved draft you selected\./);
});
