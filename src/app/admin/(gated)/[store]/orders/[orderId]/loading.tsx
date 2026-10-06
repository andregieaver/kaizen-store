const block = "animate-pulse rounded-lg bg-background";

/** One order while it is read: its heading, the items and the side cards. */
export default function OrderLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the order…</span>
      <div className="space-y-2" aria-hidden="true">
        <div className={`${block} h-4 w-16`} />
        <div className={`${block} h-8 w-56`} />
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]" aria-hidden="true">
        <div className="flex flex-col gap-6">
          <div className={`${block} h-64`} />
          <div className={`${block} h-40`} />
        </div>
        <div className="flex flex-col gap-6">
          <div className={`${block} h-32`} />
          <div className={`${block} h-48`} />
        </div>
      </div>
    </div>
  );
}
