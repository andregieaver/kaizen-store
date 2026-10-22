"use client";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";

const block = "animate-pulse rounded-lg bg-card";

/** The order editor while the order is read: its heading, the lines and the summary. */
export default function OrderEditLoading() {
  // The layout hands down the shell's words, not the drafts' (English until a page scopes them): in another language the shell's word stands in.
  const lang = useAdminLang();
  const page = useAdminText("drafts").edit.page;
  const shell = useAdminText("shell");
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{lang === "en" ? page.loading : shell.frame.loading}</span>
      <div className="space-y-2" aria-hidden="true">
        <div className={`${block} h-4 w-24`} />
        <div className={`${block} h-8 w-72`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]" aria-hidden="true">
        <div className="flex flex-col gap-6">
          <div className={`${block} h-64`} />
          <div className={`${block} h-40`} />
          <div className={`${block} h-32`} />
        </div>
        <div className={`${block} h-80`} />
      </div>
    </div>
  );
}
