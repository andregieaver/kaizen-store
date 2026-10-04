const block = "animate-pulse rounded-lg bg-background";

/** The legal pages while they are read. */
export default function LegalLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the legal pages…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-4" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`${block} h-28`} />
        ))}
      </div>
    </div>
  );
}
