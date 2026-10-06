/** The slips while they are read. */
export default function PackingSlipsLoading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the packing slips…</span>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-background" aria-hidden="true" />
      <div className="h-96 animate-pulse rounded-lg bg-background" aria-hidden="true" />
    </div>
  );
}
