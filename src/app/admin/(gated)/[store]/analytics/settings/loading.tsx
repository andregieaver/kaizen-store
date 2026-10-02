/** The settings page while it loads: the header and five cards, in the admin's placeholder. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the analytics settings</span>
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-background" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded-lg bg-background" />
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="space-y-3">
          <div className="h-6 w-48 animate-pulse rounded-lg bg-background" />
          <div className="h-40 animate-pulse rounded-lg bg-background" />
        </div>
      ))}
    </div>
  );
}
