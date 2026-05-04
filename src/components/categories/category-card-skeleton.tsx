"use client";

/**
 * Wave 27 PR-2 — loading shimmer for the card grid.
 *
 * Render 6 of these (fills the 3-col desktop grid + 2-col tablet grid
 * cleanly without orphan cells).
 */

import { Skeleton } from "@/components/ui/skeleton";

export function CategoryCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-slate-900/40 p-4">
      <div className="flex justify-between">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-5 rounded-md" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-5 w-32 flex-1" />
        <Skeleton className="h-5 w-12 rounded" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-2 w-full rounded-full" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  );
}
