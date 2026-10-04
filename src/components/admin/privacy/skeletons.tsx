const block = "animate-pulse rounded-lg bg-background";

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-56`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-6" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/** The privacy requests list while it is read. */
export function RequestsSkeleton() {
  return (
    <Frame label="Loading the privacy requests…">
      <div className={`${block} h-10 w-64`} />
      <div className={`${block} h-64`} />
    </Frame>
  );
}

/** One request, or the form that logs one, while it is read. */
export function RequestSkeleton() {
  return (
    <Frame label="Loading the request…">
      <div className={`${block} h-48`} />
      <div className={`${block} h-40`} />
    </Frame>
  );
}

/** The erase page while its preview is worked out. */
export function EraseSkeleton() {
  return (
    <Frame label="Working out what erasing would do…">
      <div className={`${block} h-72`} />
      <div className={`${block} h-32`} />
      <div className={`${block} h-40`} />
    </Frame>
  );
}

/** The platform's retention page while it is read. */
export function RetentionSkeleton() {
  return (
    <Frame label="Loading the retention schedule…">
      {[28, 40, 40, 52, 36].map((h, i) => (
        <div key={i} className={block} style={{ height: `${h * 4}px` }} />
      ))}
    </Frame>
  );
}
