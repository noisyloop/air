export function CardRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-40 shrink-0 space-y-2">
          <div className="skeleton aspect-square w-full" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function TrackListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="skeleton size-10" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-3 w-1/4" />
          </div>
          <div className="skeleton h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

export function HeaderSkeleton() {
  return (
    <div className="flex items-end gap-6">
      <div className="skeleton size-48 shrink-0" />
      <div className="flex-1 space-y-3">
        <div className="skeleton h-4 w-16" />
        <div className="skeleton h-10 w-2/3" />
        <div className="skeleton h-4 w-1/3" />
      </div>
    </div>
  );
}
