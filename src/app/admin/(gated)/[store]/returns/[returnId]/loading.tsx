const block = "animate-pulse rounded-lg bg-background";

/** A return's page while it is read: the header, the steps and the cards of the main column and the sidebar. */
export default function ReturnLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the return…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-4 w-16`} />
        <div className={`${block} h-8 w-72`} />
        <div className={`${block} h-4 w-full max-w-md`} />
      </div>
      <div className={`${block} h-5 w-full max-w-lg`} aria-hidden="true" />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]" aria-hidden="true">
        <div className="flex flex-col gap-6">
          <div className={`${block} h-48`} />
          <div className={`${block} h-56`} />
          <div className={`${block} h-40`} />
        </div>
        <div className="flex flex-col gap-6">
          <div className={`${block} h-32`} />
          <div className={`${block} h-24`} />
        </div>
      </div>
    </div>
  );
}
