/** The pick list while the orders are read. */
export default function PickListLoading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the pick list…</span>
      <div className="h-8 w-40 animate-pulse rounded-lg bg-background" aria-hidden="true" />
      <div className="h-10 w-96 max-w-full animate-pulse rounded-lg bg-background" aria-hidden="true" />
      <div className="h-96 animate-pulse rounded-lg bg-background" aria-hidden="true" />
    </div>
  );
}
