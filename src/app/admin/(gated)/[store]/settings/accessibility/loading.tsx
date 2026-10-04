const block = "animate-pulse rounded-lg bg-background";

/** The accessibility page while it is read. */
export default function AccessibilityLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the accessibility page…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-6" aria-hidden="true">
        {[24, 48, 56].map((height, i) => (
          <div key={i} className={block} style={{ height: `${height * 4}px` }} />
        ))}
      </div>
    </div>
  );
}
