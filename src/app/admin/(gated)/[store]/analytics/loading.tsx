import { SectionSkeleton } from "@/components/admin/analytics/overview-sections";

/**
 * What the Overview shows while its first screen is read (the figures and charts, not the sections that stream in after it): the
 * shape of the page in the page's own order and in the admin's placeholder style, the places of the streamed sections the same
 * placeholders the page then shows for them (`SectionSkeleton`), so nothing moves when the page takes over.
 */
export default function AnalyticsOverviewLoading() {
  const block = "animate-pulse rounded-lg bg-background";
  return (
    <div className="flex flex-col gap-8" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the overview…</span>
      <div className="space-y-3">
        <div className={`${block} h-8 w-40`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
        <div className={`${block} h-9 w-full max-w-3xl`} />
      </div>
      <div className="flex flex-col gap-8" aria-hidden="true">
        <SectionSkeleton kind="alerts" label="what needs you today" />
        <div className="space-y-3">
          <div className={`${block} h-6 w-56`} />
          <div className={`${block} h-24`} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className={`${block} h-32`} />
            ))}
          </div>
        </div>
        <SectionSkeleton kind="why" label="why sales changed" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={`${block} h-64`} />
          <div className={`${block} h-64`} />
        </div>
      </div>
    </div>
  );
}
