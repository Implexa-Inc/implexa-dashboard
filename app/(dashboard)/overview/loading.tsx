/** Home skeleton — mirrors the build box + todo list while data loads. */
import { Skeleton, SkeletonCard } from '../_components/skeleton';

export default function Loading() {
  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        {/* build box */}
        <div className="card p-6 sm:p-8">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-3/4 mt-3" />
          <Skeleton className="h-12 w-full mt-5" />
        </div>
        {/* todo list */}
        <div className="space-y-3 mt-10">
          <Skeleton className="h-3 w-24" />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </main>
  );
}
