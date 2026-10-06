const block = "animate-pulse rounded-lg bg-background";

/** The Orders page while the list is read: the heading, the view bar, the search and rows. */
export default function OrdersLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the orders…</span>
      <div className={`${block} h-8 w-40`} aria-hidden="true" />
      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className={`${block} h-9 w-full max-w-xl`} />
        <div className={`${block} h-14`} />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`${block} h-12`} />
          ))}
        </div>
      </div>
    </div>
  );
}
