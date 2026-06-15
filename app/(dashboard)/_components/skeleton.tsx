/**
 * <Skeleton /> — a single shimmering placeholder block. The building block for
 * route-level loading.tsx skeletons so a slow server fetch shows instant shape
 * instead of a blank screen. Pure presentational; size via className.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-ink-800/70 ${className}`} aria-hidden="true" />;
}

/** A card-shaped skeleton (matches the .card surface used across the dashboard). */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`card ${className}`}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3 mt-2.5" />
      <Skeleton className="h-3 w-1/2 mt-2" />
    </div>
  );
}
