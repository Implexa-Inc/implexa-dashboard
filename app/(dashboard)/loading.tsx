/**
 * Generic dashboard route skeleton. Next.js renders this instantly while a
 * route's server component fetches, so navigation never shows a blank screen.
 * Applies to every (dashboard) route that doesn't define its own loading.tsx.
 */
import { Skeleton, SkeletonCard } from './_components/skeleton';

export default function Loading() {
  return (
    <main className="min-h-screen px-4 sm:px-6 lg:px-12 py-12">
      <div className="max-w-3xl mx-auto">
        <Skeleton className="h-7 w-2/5" />
        <Skeleton className="h-4 w-3/5 mt-3" />
        <div className="space-y-3 mt-8">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </main>
  );
}
