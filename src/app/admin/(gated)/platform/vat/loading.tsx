const block = "animate-pulse rounded-lg bg-background";

/** The VAT pages while they are read: the heading and the cards. */
export default function PlatformVatLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading VAT…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-32`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-6" aria-hidden="true">
        {[48, 72, 64, 56, 52].map((height, i) => (
          <div key={i} className={block} style={{ height: `${height * 4}px` }} />
        ))}
      </div>
    </div>
  );
}
