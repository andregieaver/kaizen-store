"use client";

import { useAdminText } from "@/components/admin/admin-text";

const block = "animate-pulse rounded-lg bg-card";

/**
 * Any page here while its data is read (code review FS1): a click answers at once with the page's outline, where the old
 * page used to stay put until everything was read and the person clicked again. A page with a fitted skeleton of its own
 * (`loading.tsx` beside it) shows that one instead.
 */
export default function AdminPageLoading() {
  const shell = useAdminText("shell");
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{shell.frame.loading}</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-14`} />
        ))}
      </div>
    </div>
  );
}
