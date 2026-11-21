import Link from 'next/link';
import { WORK_VIEWS, WORK_VIEW_LABELS, workViewHref, type WorkView } from '@/lib/navigation';

/** Real URL filters, including old notification/deep-link destinations. Unknown counts stay unknown. */
export default function WorkFilterTabs({current, counts = {}}: {
  current: WorkView; counts?: Partial<Record<WorkView, {count:number;complete:boolean}>>;
}) {
  return <nav aria-label="Work filters" className="work-filters"><ul>
    {WORK_VIEWS.map(view => {
      const count=counts[view];
      return <li key={view}><Link href={workViewHref(view)} aria-current={current===view?'page':undefined}>
        {WORK_VIEW_LABELS[view]}{view!=='delivered' && count && <span className="work-filter-count" aria-label={!count.complete && count.count===0 ? 'Count unavailable' : `${count.complete?'':'At least '}${count.count} items`}>{!count.complete&&count.count===0?'?':`${count.count}${count.complete?'':'+'}`}</span>}
      </Link></li>;
    })}
  </ul></nav>;
}
