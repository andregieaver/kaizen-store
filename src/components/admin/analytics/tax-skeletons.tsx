/**
 * What the VAT, OSS and IOSS page shows while its figures are read (D161): the shape of the page in the admin's placeholder style
 * (`animate-pulse rounded-lg bg-background`, which sweeps), with the statement that these are not a tax return already in words, so it is
 * never missing while the numbers load.
 */
const block = "animate-pulse rounded-lg bg-background";

export function TaxSkeleton() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the VAT report…</span>
      <div className="space-y-3">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
        <div className={`${block} h-9 w-full max-w-3xl`} />
      </div>
      <div className={`${block} h-9 w-full max-w-md`} />
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">Your own figures, for you and your accountant. Not a tax return.</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-28`} />
        ))}
      </div>
      <div className={`${block} h-80`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${block} h-64`} />
        <div className={`${block} h-64`} />
      </div>
    </div>
  );
}
