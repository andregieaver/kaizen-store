"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A level's main area beside its sidebar (D107). Editors (a page's own
 * address, or a new page) use the whole width without the sidebar (D53);
 * decided from the address rather than from what the page holds, since
 * pages left behind stay in the document (hidden) for going back.
 * `fullWidth` is a regular expression's source, as a function cannot
 * cross from the server. A `wide` level (D144) lets the main area stretch
 * across the screen beside its sidebar instead of stopping at the content width.
 */
export function AdminMain({ sidebar, fullWidth, wide = false, children }: { sidebar: ReactNode; fullWidth: string; wide?: boolean; children: ReactNode }) {
  if (new RegExp(fullWidth).test(usePathname())) {
    return <main className="flex w-full min-w-0 flex-1 flex-col px-4 py-8">{children}</main>;
  }
  return (
    <div className={`mx-auto flex w-full flex-1 gap-10 px-4 ${wide ? "" : "max-w-7xl"}`}>
      {sidebar}
      <main className="min-w-0 flex-1 py-8">{children}</main>
    </div>
  );
}
