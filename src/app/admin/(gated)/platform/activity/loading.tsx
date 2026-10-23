"use client";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";

const block = "animate-pulse rounded-lg bg-card";

/** The platform's activity log while it is read. */
export default function PlatformActivityLoading() {
  // The layout hands down the shell's words: in another language the shell's own word stands in.
  const lang = useAdminLang();
  const shell = useAdminText("shell");
  const platform = useAdminText("platform");
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{lang === "en" ? platform.loadingActivity : shell.frame.loading}</span>
      <div className="space-y-3" aria-hidden="true">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={`${block} h-16`} />
        ))}
      </div>
    </div>
  );
}
