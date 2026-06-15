/** Agent detail skeleton — header + tabs + a content block. */
import { Skeleton, SkeletonCard } from '../../_components/skeleton';

export default function Loading() {
  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-3/5 mt-4" />
        <Skeleton className="h-4 w-2/5 mt-3" />
        {/* tab row */}
        <div className="flex gap-3 mt-6">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="space-y-3 mt-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </main>
  );
}
