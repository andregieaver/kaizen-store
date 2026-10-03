const block = "animate-pulse rounded-lg bg-background";

/** The return rules while they are read: the heading and the five cards of the form. */
export default function ReturnSettingsLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the return rules…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-6" aria-hidden="true">
        {[36, 44, 32, 40, 56].map((height, i) => (
          <div key={i} className={`${block}`} style={{ height: `${height * 4}px` }} />
        ))}
      </div>
    </div>
  );
}
