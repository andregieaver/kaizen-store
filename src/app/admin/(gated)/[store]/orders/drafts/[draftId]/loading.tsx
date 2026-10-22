"use client";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";

const block = "animate-pulse rounded-lg bg-card";

/** The drafts list while it is read. */
export default function DraftLoading() {
  // The layout hands down the shell's words, not the drafts' (English until a page scopes them): in another language the shell's word stands in.
  const lang = useAdminLang();
  const pages = useAdminText("drafts").pages;
  const shell = useAdminText("shell");
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{lang === "en" ? pages.loadingDraft : shell.frame.loading}</span>
      <div className={`${block} h-8 w-48`} aria-hidden="true" />
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-12`} />
        ))}
      </div>
    </div>
  );
}
