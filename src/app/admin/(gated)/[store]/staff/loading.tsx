const block = "animate-pulse rounded-lg bg-background";

/** The team while it is read: the heading, the members and the forms. */
export default function TeamLoading() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the team…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-40`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-6" aria-hidden="true">
        {[64, 36, 56].map((height, i) => (
          <div key={i} className={block} style={{ height: `${height * 4}px` }} />
        ))}
      </div>
    </div>
  );
}
