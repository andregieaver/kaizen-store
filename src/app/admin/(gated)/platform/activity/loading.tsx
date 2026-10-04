const block = "animate-pulse rounded-lg bg-background";

/** The platform's activity log while it is read. */
export default function PlatformActivityLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the activity log…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={`${block} h-16`} />
        ))}
      </div>
    </div>
  );
}
