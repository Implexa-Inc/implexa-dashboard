/**
 * <RunStepsList /> — the presentational half of an agent's step checklist.
 *
 * WHY IT IS ITS OWN COMPONENT. This list is rendered on two surfaces now: the
 * run permalink, where <RunStepChecklist> polls the backend and feeds it, and
 * the Production page, where the server read model already carries each node's
 * steps. Two implementations of "which steps are done" is how the same run ends
 * up looking finished on one page and stuck on the other, so there is one
 * renderer and both surfaces hand it the SAME typed rows.
 *
 * The prop type is the intersection both models satisfy — skill_runs.steps_state
 * (migration 0089) and production.nodes[].execution.steps are the same fact from
 * the same column, projected twice.
 *
 * Pure and presentational: no polling, no fetching, no router. The Production
 * page passes `compact` for its per-node sections, which changes density only —
 * never which steps are shown or what they are called.
 */

export type StepListStatus = 'pending' | 'running' | 'done' | 'failed';
export type StepListItem = { index: number; label?: string | null; status: StepListStatus };

// Per-status glyph + tint. running = spinner (it's the live one), done = check,
// failed = ✕, pending = hollow dot.
export function StepIcon({ status }: { status: StepListStatus }) {
  if (status === 'running') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-sky-500/25 border-t-sky-500 animate-spin" aria-hidden="true" />;
  }
  if (status === 'done') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500/15 text-state-ok grid place-items-center text-[9px] font-bold" aria-hidden="true">✓</span>;
  }
  if (status === 'failed') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-rose-500/15 text-state-fail grid place-items-center text-[9px] font-bold" aria-hidden="true">✕</span>;
  }
  return <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-ink-700" aria-hidden="true" />;
}

export function stepSummary(steps: StepListItem[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.status === 'done').length, total: steps.length };
}

export type ProgressPresentation = {
  state: 'queued' | 'running' | 'waiting' | 'stalled' | 'failed' | 'completed';
  note?: string | null;
  elapsedMs?: number | null;
  expectedMs?: number | null;
};

function duration(ms:number){
  const seconds=Math.max(0,Math.floor(ms/1000));
  if(seconds>=86400)return `${Math.floor(seconds/86400)}d ${Math.floor(seconds/3600)%24}h`;
  if(seconds>=3600)return `${Math.floor(seconds/3600)}h ${Math.floor(seconds/60)%60}m`;
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

export default function RunStepsList({steps,live=false,compact=false,heading='Steps',action=null,progress}:{
  steps:StepListItem[];live?:boolean;compact?:boolean;heading?:string|null;action?:React.ReactNode;progress?:ProgressPresentation;
}){
  const {done,total}=stepSummary(steps||[]);
  // Production nodes retain their compact checklist and the same source rows.
  if(compact){
    if(!total)return null;
    return <div>{heading!==null&&<div className="flex items-center gap-4 mb-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink-100">{live?'Working on your result':heading}</p><p className="mt-1 text-xs text-ink-400">{done} of {total} steps complete</p>{live&&<p className="mt-1 text-sm text-state-running">{steps.find(s=>s.status==='running')?.label||'Waiting for the next step'}</p>}</div>{action}</div>}<ol className="space-y-1.5">{steps.map(s=><li key={s.index} className="flex items-center gap-2.5 text-xs"><StepIcon status={s.status}/><span className="text-[11px] font-mono text-ink-600 shrink-0">{s.index}/{total}</span><span className={s.status==='pending'?'text-ink-500 truncate':'text-ink-100 truncate'}>{s.label||`Step ${s.index}`}</span></li>)}</ol></div>;
  }
  if(!total&&!progress)return null;
  const state=progress?.state||(live?'running':steps.some(s=>s.status==='failed')?'failed':done===total?'completed':'queued');
  const current=steps.find(s=>s.status==='failed')||steps.find(s=>s.status==='running')||steps.find(s=>s.status==='pending');
  const currentPosition=current?steps.indexOf(current):0;
  const waiting=state==='waiting'||state==='stalled',failed=state==='failed',moving=state==='running';
  const tone=failed?'failed':waiting?'waiting':state==='completed'?'completed':moving?'running':'queued';
  const label=total&&current?`${failed?'Stopped at step':'Step'} ${currentPosition+1} of ${total}${state==='waiting'?' · paused':state==='stalled'?' · interrupted':''}`:state==='completed'?'Steps complete':state==='queued'?'Waiting to start':failed?'Run stopped':state==='stalled'?'Progress interrupted':waiting?'Waiting for you':'Getting started';
  const title=current?.label||(current?`Step ${current.index}`:state==='completed'?'All steps complete':state==='queued'?'Waiting to start':failed?'Run stopped':state==='stalled'?'Progress interrupted':waiting?'Waiting for you':'Working on your result');
  const elapsed=progress?.elapsedMs;
  const estimate=progress?.expectedMs;
  const remaining=typeof elapsed==='number'&&typeof estimate==='number'&&estimate>0?estimate-elapsed:null;
  return <section className={`run-progress-panel is-${tone}`} aria-label="Run progress">
    <div className="run-progress-top">
      <div className="run-progress-ring"><svg viewBox="0 0 100 100" role="img" aria-label={total?`${done} of ${total} steps complete`:'No steps reported yet'}>
        <circle className="run-progress-track" cx="50" cy="50" r="40"/>
        {done>0&&<circle className="run-progress-done" cx="50" cy="50" r="40" pathLength="100" strokeDasharray={`${done/total*96} 100`} transform="rotate(-90 50 50)"/>}
        {current&&<circle className="run-progress-current" cx="50" cy="50" r="40" pathLength="100" strokeDasharray={`${Math.max(.5,96/total-1.2)} 100`} strokeDashoffset={-currentPosition*96/total-.6} transform="rotate(-90 50 50)"/>}
        {moving&&current&&<g className="run-progress-orbit"><circle cx="50" cy="10" r="3.2"/></g>}
      </svg><div className="run-progress-middle"><b>{total?done:'—'}</b><span>{total?`of ${total} done`:'No steps yet'}</span></div></div>
      <div className="run-progress-copy"><p className="run-progress-label">{label}</p><h2>{title}</h2>
        {progress?.note&&<p className="run-progress-note"><i aria-hidden="true"/>{progress.note}</p>}
        <div className="run-progress-times">
          {waiting?<div><b>{state==='stalled'?'Interrupted':'Paused'}</b><span>{state==='waiting'?'Waiting for your input':'Check the recorded run status'}</span></div>:failed?<div><b>Stopped</b><span>Review the details beside this progress</span></div>:moving&&remaining!==null?<div><b>{remaining>0?`About ${Math.max(1,Math.ceil(remaining/60000))} min left`:'Taking longer than estimated'}</b><span>Based on this run’s estimate</span></div>:null}
          {typeof elapsed==='number'&&Number.isFinite(elapsed)&&<div><b>{duration(elapsed)}</b><span>elapsed</span></div>}
        </div>
      </div>{action}
    </div>
    {!!total&&<ol className="run-progress-steps">{steps.map(s=>{
      const active=s===current;const rowTone=active?failed?'failed':waiting?'waiting':moving?'running':s.status:s.status;
      return <li key={s.index} className={`is-${rowTone}`}><span className="run-progress-marker" aria-hidden="true">{s.status==='done'?'✓':rowTone==='failed'||rowTone==='waiting'?'!':rowTone==='running'?<i/>:s.index}</span><div><b>{s.label||`Step ${s.index}`}</b>{active&&progress?.note&&<span>{progress.note}</span>}</div><small>{active?(failed?'Failed':state==='stalled'?'Interrupted':waiting?'Paused':moving?'Now':''):''}</small></li>;
    })}</ol>}
  </section>;
}
