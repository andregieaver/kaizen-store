const block = "animate-pulse rounded-lg bg-background";

/** The order editor while the order is read: its heading, the lines and the summary. */
export default function OrderEditLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the order…</span>
      <div className="space-y-2" aria-hidden="true">
        <div className={`${block} h-4 w-24`} />
        <div className={`${block} h-8 w-72`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]" aria-hidden="true">
        <div className="flex flex-col gap-6">
          <div className={`${block} h-64`} />
          <div className={`${block} h-40`} />
          <div className={`${block} h-32`} />
        </div>
        <div className={`${block} h-80`} />
      </div>
    </div>
  );
}
