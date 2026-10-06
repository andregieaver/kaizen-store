const block = "animate-pulse rounded-lg bg-background";

/** The drafts list while it is read. */
export default function DraftLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the draft…</span>
      <div className={`${block} h-8 w-48`} aria-hidden="true" />
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-12`} />
        ))}
      </div>
    </div>
  );
}
