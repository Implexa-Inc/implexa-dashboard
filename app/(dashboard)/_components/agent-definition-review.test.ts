import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
register(new URL('../../../scripts/dom-test-loader.mjs', import.meta.url));
let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Review: typeof import('./agent-definition-review.tsx').default;
const dom = new JSDOM('<!doctype html><body></body>');
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
before(async () => {
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent'])
    Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('Review must not submit'); };
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  Review = (await import('./agent-definition-review.tsx')).default;
});
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });
const definition = { workflow_id: 'agent', workflow_version_id: 'exact-version', steps: [{ order: 1, label: '<script>bad()</script>', inputs: ['source'], outputs: ['result'] }] };

test('Check action uses explicit readiness, retains uncertain identity and reads completion without rerunning', async () => {
  const { DefinitionCheckAction } = await import('./agent-definition-review.tsx');
  const values = new Map<string,string>();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const posts:any[]=[];let status:any={ok:true,requestBusReady:true,request:null};
  globalThis.fetch=(async (_url:any,init:any)=>{
    if(init?.method==='POST'){posts.push(JSON.parse(init.body));if(posts.length===1)throw new Error('lost reply');return {ok:true,json:async()=>({ok:true,requestId:posts[0].requestId,state:'pending'})};}
    return {ok:true,json:async()=>status};
  }) as any;
  const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text)!;
  try{
    await React.act(async()=>root.render(React.createElement(DefinitionCheckAction,{slug:'planner',baseVersionId:'base',blocked:false})));
    assert.equal(button('Check definition').disabled,true);assert.equal(posts.length,0);
    await React.act(async()=>button('Refresh Check status').click());
    await React.act(async()=>button('Check definition').click());
    assert.match(host.textContent!,/delivery is unconfirmed/);assert.equal(values.size,1);
    await React.act(async()=>button('Resubmit same Check request').click());
    assert.deepEqual(posts[0],posts[1]);assert.deepEqual(Object.keys(posts[0]).sort(),['baseVersionId','requestId']);
    assert.equal(button('Request another Check').disabled,true);
    status={ok:true,requestBusReady:true,request:{requestId:posts[0].requestId,state:'done'}};
    await React.act(async()=>button('Refresh Check status').click());assert.equal(posts.length,2);
    assert.match(host.textContent!,/findings remain unreviewed/);
    await React.act(async()=>root.render(React.createElement(DefinitionCheckAction,{slug:'planner',baseVersionId:'base',blocked:true})));
    assert.equal(button('Request another Check').disabled,true);
  }finally{await React.act(async()=>root.unmount());host.remove();globalThis.fetch=originalFetch;}
});

test('a confirmed duplicate refusal clears only the rejected identity and discovers the existing Check',async()=>{
  const {DefinitionCheckAction}=await import('./agent-definition-review.tsx');
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let reads=0;
  globalThis.fetch=(async(_url:any,init:any)=>({ok:init?.method!=='POST',json:async()=>init?.method==='POST'?{ok:false,reason:'check_already_pending'}:{ok:true,requestBusReady:true,request:++reads===1?null:{requestId:'existing',state:'pending'}}})) as any;
  const click=async(text:string)=>React.act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text)!.click());
  try{
    await React.act(async()=>root.render(React.createElement(DefinitionCheckAction,{slug:'planner',baseVersionId:'base',blocked:false})));
    await click('Refresh Check status');await click('Check definition');assert.equal(values.size,0);
    assert.match(host.textContent!,/Another Check is already pending/);await click('Refresh Check status');
    assert.match(host.textContent!,/existing — pending/);
    assert.equal(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Request another Check')!.disabled,true);
  }finally{await React.act(async()=>root.unmount());host.remove();globalThis.fetch=originalFetch;}
});

test('real modal opens, shows exact contract safely, says unchecked, closes; no action request', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await React.act(async () => { root.render(React.createElement(Review, { definition, versionSource: 'live', updateAvailable: false, revisePending: false, statusUnavailable: false })); });
    assert.equal(host.querySelector('[role="dialog"]'), null);
    await React.act(async () => { host.querySelector('button')!.click(); });
    assert.ok(host.querySelector('[role="dialog"]'));
    assert.match(host.textContent!, /Live version at page load/);
    assert.match(host.textContent!, /exact-version/);
    assert.match(host.textContent!, /"outputs"/);
    assert.equal(host.querySelector('script'), null);
    assert.match(host.textContent!, /Read-only definition Check/);
    assert.match(host.textContent!, /does not mean no issues were found/);
    assert.deepEqual(Array.from(host.querySelectorAll('button')).map(b => b.textContent?.trim()), ['Review definition', '×']);
    await React.act(async () => { (host.querySelector('[aria-label="Close"]') as HTMLButtonElement).click(); });
    assert.equal(host.querySelector('[role="dialog"]'), null);
    assert.equal(fetchCalls, 0);
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});

test('unavailable, installed/update, unknown and pending states never say current checked', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    for (const [props, copy] of [
      [{ definition: null, versionSource: null }, 'exact versioned definition is unavailable'],
      [{ definition, versionSource: 'installed', updateAvailable: true }, 'must not be treated as the current edit base'],
      [{ definition, versionSource: null }, 'currentness not established'],
      [{ definition, versionSource: 'live', revisePending: true }, 'An edit is pending'],
      [{ definition, versionSource: 'live', statusUnavailable: true }, 'Edit status is unavailable'],
    ] as const) {
      await React.act(async () => { root.render(React.createElement(Review, { definition, versionSource: 'live', updateAvailable: false, revisePending: false, statusUnavailable: false, ...props })); });
      if (!host.querySelector('[role="dialog"]')) await React.act(async () => host.querySelector('button')!.click());
      assert.ok(host.textContent!.includes(copy));
      assert.match(host.textContent!, /Definition review is not execution verification/);
    }
    assert.equal(fetchCalls, 0);
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});

test('agent page passes the exact envelope and source, without changing the Edit path', () => {
  const page = readFileSync(new URL('../workflows/[slug]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /<AgentDefinitionReview definition=\{workflow\.revision_contract \?\? null\} versionSource=\{workflow\.definition_version_source \?\? null\}/);
  assert.match(page, /updateAvailable=\{!!workflow\.update_available\} revisePending=\{revisePending\} statusUnavailable=\{lifecycleUnavailable\}/);
});

test('saved report load and preview use IDs/text only, display operator provenance and never Apply', async () => {
  const { SavedDefinitionFindings } = await import('./agent-definition-review.tsx');
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(init?.method === 'POST'
      ? { ok: true, status: 'preview', baseVersionId: 'v1', change: { before: '33', after: '34' }, reviewRequired: true, applyAllowed: false }
      : { ok: true, baseVersionId: 'v1', state: 'saved_reports', historical: false, items: [{ reportId: 'report', assessmentId: 'assessment', finding: { id: 'F1', explanation: 'Count mismatch', quotes: [{ location: 'stage 1', text: '33' }] }, provenance: 'Operator-attested; independence not verified', classification: { status: 'draft_candidate', draftEligible: true } }] }));
  }) as typeof fetch;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(SavedDefinitionFindings, { slug: 'planner', baseVersionId: 'v1', previewBlocked: false })));
    await React.act(async () => host.querySelector('button')!.click());
    assert.match(host.textContent!, /independence not verified/);
    const textarea = host.querySelector('textarea')!;
    await React.act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!; setter.call(textarea, '34'); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await React.act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Preview replacement')!.click());
    assert.equal(calls.length, 2);
    assert.deepEqual(Object.keys(calls[1].body).sort(), ['assessmentId', 'baseVersionId', 'edit', 'findingId', 'reportId']);
    assert.deepEqual(calls[1].body.edit, { location: 'stage 1', before: '33', after: '34' });
    assert.match(host.textContent!, /Unreviewed draft — not applied/);
    assert.ok(!Array.from(host.querySelectorAll('button')).some(b => /Apply|Run/.test(b.textContent || '')));
  } finally { await React.act(async () => root.unmount()); host.remove(); globalThis.fetch = originalFetch; }
});

test('saved review load distinguishes unavailable/no report and hides stale/conflicting previews', async () => {
  const { SavedDefinitionFindings } = await import('./agent-definition-review.tsx');
  for (const [body, expected] of [
    [{ ok: false }, 'Saved review unavailable'],
    [{ ok: true, baseVersionId: 'v1', state: 'no_saved_report', items: [] }, 'not a passing Check'],
    [{ ok: true, baseVersionId: 'v1', state: 'saved_reports', truncated: true, items: [{ reportId: 'r', assessmentId: 'a', assessment: { rationale: 'Source changed' }, finding: { id: 'F1', explanation: 'Count', quotes: [] }, provenance: 'Operator-attested', classification: { status: 'stale', draftEligible: false } }] }, 'Showing the latest 20 reports'],
    [{ ok: true, baseVersionId: 'v1', state: 'saved_reports', items: [{ reportId: 'r', assessmentId: 'a', finding: { id: 'F1', explanation: 'Count', quotes: [] }, provenance: 'Operator-attested', classification: { status: 'conflicting_assessments', draftEligible: false } }] }, 'conflicting_assessments'],
  ] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify(body));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await React.act(async () => root.render(React.createElement(SavedDefinitionFindings, { slug: 'planner', baseVersionId: 'v1', previewBlocked: false })));
      await React.act(async () => host.querySelector('button')!.click());
      assert.ok(host.textContent!.includes(expected)); assert.equal(host.querySelector('textarea'), null);
    } finally { await React.act(async () => root.unmount()); host.remove(); }
  }
  globalThis.fetch = originalFetch;
});

test('generated reports show request provenance, empty summaries and alternative readings without edit authority', async () => {
  const { SavedDefinitionFindings } = await import('./agent-definition-review.tsx');
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, baseVersionId: 'v1', state: 'saved_reports',
    reports: [{ reportId: 'empty-report', requestId: 'check-1', provenanceKind: 'system_generated', findingCount: 0, state: 'no_findings_reported' }],
    items: [{ reportId: 'other-report', assessmentId: null, provenance: 'Automated Check, unreviewed', classification: { status: 'unreviewed', draftEligible: false },
      finding: { id: 'F1', explanation: 'Possible count mismatch', quotes: [], plausibleCompliantInterpretation: 'Distinct file groups', missingEvidence: ['Actual generated file list'] } }] }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(SavedDefinitionFindings, { slug: 'planner', baseVersionId: 'v1', previewBlocked: false })));
    await React.act(async () => host.querySelector('button')!.click());
    assert.match(host.textContent!, /empty-report: 0 finding\(s\).*not certification/);
    assert.match(host.textContent!, /Check request: check-1/);
    assert.match(host.textContent!, /Possible compliant interpretation: Distinct file groups/);
    assert.match(host.textContent!, /Evidence still needed: Actual generated file list/);
    assert.equal(host.querySelector('textarea'), null);
    assert.deepEqual(Array.from(host.querySelectorAll('button')).map(b => b.textContent), ['Load saved Check reports']);
  } finally { await React.act(async () => root.unmount()); host.remove(); globalThis.fetch = originalFetch; }
});
