const block = "animate-pulse rounded-lg bg-background";

/** The queue's shape while it is read: the heading, the four figures, the filter and the table, in the admin's placeholder style. */
export function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the returns…</span>
      <div className="space-y-3">
        <div className={`${block} h-8 w-32`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${block} h-24`} />
        ))}
      </div>
      <div className={`${block} h-12`} aria-hidden="true" />
      <div className={`${block} h-64`} aria-hidden="true" />
    </div>
  );
}
