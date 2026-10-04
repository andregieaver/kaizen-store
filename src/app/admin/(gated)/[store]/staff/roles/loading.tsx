const block = "animate-pulse rounded-lg bg-background";

/** The roles while they are read. */
export default function RolesLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the roles…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-40`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-4" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-16`} />
        ))}
      </div>
    </div>
  );
}
