import type { ReactNode } from 'react';
import Link from 'next/link';

/** Shared Work presentation. Callers retain their existing identities and actions. */
export default function WorkItemRow({title, detail, href, state, when, actions, progress}: {
  title: string; detail?: ReactNode; href?: string | null;
  state: 'Needs input' | 'Needs approval' | 'Ready for review' | 'Running' | 'Revising' | 'Accepted' | 'Delivered' | 'Failed';
  when?: ReactNode; actions: ReactNode; progress?: {value:number;total:number};
}) {
  const tone = state === 'Failed' ? 'fail' : state.startsWith('Needs') ? 'needs'
    : state === 'Ready for review' ? 'review' : state === 'Running' || state === 'Revising' ? 'running' : 'ok';
  return <div className="work-item-row group">
    {/* No thumbnail metadata is supplied by these readers yet. Never substitute a fake output. */}
    <span className="work-row-thumb" aria-hidden="true"><svg><use href="/brand/tukido-icons.svg#work"/></svg></span>
    <div className="work-row-main">
      {href ? <Link href={href} prefetch={false} className="work-row-title">{title}</Link> : <span className="work-row-title">{title}</span>}
      {detail && <div className="work-row-sub">{detail}</div>}
      {progress && progress.total > 0 && <div className="work-row-progress" role="progressbar" aria-label="Steps completed" aria-valuenow={Math.min(progress.total, Math.max(0,progress.value))} aria-valuemin={0} aria-valuemax={progress.total}><i style={{width:`${Math.min(100, Math.max(0,progress.value / progress.total * 100))}%`}}/></div>}
    </div>
    <span className={`work-row-state ${tone}`}>{state}</span>
    <span className="work-row-when">{when}</span>
    <div className="work-row-actions">{actions}</div>
  </div>;
}
