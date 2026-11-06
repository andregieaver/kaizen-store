import { LoadingWords } from "@/components/admin/loading-words";

const block = "animate-pulse rounded-lg bg-card";

/** The automation rules while they are read: the log of runs. */
export default function AutomationLogLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only"><LoadingWords of="log" /></span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className={`${block} h-64`} aria-hidden="true" />
    </div>
  );
}
