/** What Subscriptions shows while its figures are read: the shape of the page in the admin's placeholder style. */
export default function AnalyticsSubscriptionsLoading() {
  const block = "animate-pulse rounded-lg bg-background";
  return (
    <div className="flex flex-col gap-8" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading subscriptions…</span>
      <div className="space-y-3">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
        <div className={`${block} h-9 w-full max-w-3xl`} />
      </div>
      <div className="space-y-3">
        <div className={`${block} h-6 w-56`} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`${block} h-32`} />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className={`${block} h-6 w-40`} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className={`${block} h-80`} />
          <div className={`${block} h-80`} />
        </div>
      </div>
      <div className="space-y-3">
        <div className={`${block} h-6 w-32`} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`${block} h-28`} />
          ))}
        </div>
      </div>
    </div>
  );
}
