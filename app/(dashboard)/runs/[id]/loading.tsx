/** Run permalink skeleton — header + a deliverable block. */
import { Skeleton } from '../../_components/skeleton';

export default function Loading() {
  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-1/2 mt-4" />
        <Skeleton className="h-4 w-2/5 mt-3" />
        <div className="rounded-lg border border-ink-800 bg-ink-950/60 p-5 mt-6 space-y-2.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-full mt-4" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </main>
  );
}
