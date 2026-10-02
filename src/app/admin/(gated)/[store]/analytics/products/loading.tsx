/** What the Products page shows while its figures are read: the shape of the page in the admin's placeholder style. */
export default function AnalyticsProductsLoading() {
  const block = "animate-pulse rounded-lg bg-background";
  return (
    <div className="flex flex-col gap-8" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the product figures…</span>
      <div className="space-y-3">
        <div className={`${block} h-8 w-40`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
        <div className={`${block} h-9 w-full max-w-3xl`} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={`${block} h-32`} />
        ))}
      </div>
      <div className={`${block} h-72`} />
      <div className={`${block} h-96`} />
    </div>
  );
}
