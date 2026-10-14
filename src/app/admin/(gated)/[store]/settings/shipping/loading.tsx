const block = "animate-pulse rounded-lg bg-card";

/** The shipping settings while they are read: the heading and a few cards. Shared by the hub and its pages. */
export default function ShippingLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the shipping settings…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-6" aria-hidden="true">
        {[40, 32, 24, 24].map((height, i) => (
          <div key={i} className={block} style={{ height: `${height * 4}px` }} />
        ))}
      </div>
    </div>
  );
}
