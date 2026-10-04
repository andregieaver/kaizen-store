const block = "animate-pulse rounded-lg bg-background";

/** The tax settings while they are read: the heading, the readiness list and the cards of the form. */
export default function TaxSettingsLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the tax settings…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-32`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-6" aria-hidden="true">
        {[36, 56, 40, 64, 28].map((height, i) => (
          <div key={i} className={block} style={{ height: `${height * 4}px` }} />
        ))}
      </div>
    </div>
  );
}
