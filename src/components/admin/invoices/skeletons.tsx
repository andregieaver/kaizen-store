const block = "animate-pulse rounded-lg bg-background";

/** The invoices page's shape while it is read: the heading, the four figures, the tabs, the filter and the table. */
export function InvoicesSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the invoices…</span>
      <div className="space-y-3">
        <div className={`${block} h-8 w-40`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${block} h-24`} />
        ))}
      </div>
      <div className={`${block} h-10 w-80`} aria-hidden="true" />
      <div className={`${block} h-12`} aria-hidden="true" />
      <div className={`${block} h-64`} aria-hidden="true" />
    </div>
  );
}

/** The invoicing settings' shape while they are read. */
export function InvoiceSettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the invoicing settings…</span>
      <div className="space-y-3">
        <div className={`${block} h-8 w-40`} />
        <div className={`${block} h-4 w-full max-w-2xl`} />
      </div>
      <div className={`${block} h-40`} aria-hidden="true" />
      <div className={`${block} h-56`} aria-hidden="true" />
      <div className={`${block} h-48`} aria-hidden="true" />
    </div>
  );
}
