/** What the Inventory page shows while its figures are read: the shape of the page in the admin's placeholder style. */
export default function AnalyticsInventoryLoading() {
  const block = "animate-pulse rounded-lg bg-background";
  return (
    <div className="flex flex-col gap-8" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the stock figures…</span>
      <div className="space-y-3">
        <div className={`${block} h-8 w-40`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className={`${block} h-40`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-28`} />
        ))}
      </div>
      <div className={`${block} h-9 w-full max-w-xl`} />
      <div className={`${block} h-80`} />
    </div>
  );
}
