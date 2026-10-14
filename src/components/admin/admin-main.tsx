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
 * `railed`: the page sits beside the rail (docs/admin-style.md 6.3).
 */
export function AdminMain({ sidebar, fullWidth, wide = false, railed = false, children }: { sidebar: ReactNode; fullWidth: string; wide?: boolean; railed?: boolean; children: ReactNode }) {
  // Beside the rail (layout `rail`) the page sits under a plain top bar: the canvas's own room at the sides, less above.
  const pad = railed ? "px-4 md:px-8" : "px-4";
  const y = railed ? "pt-2 pb-10" : "py-8";
  if (new RegExp(fullWidth).test(usePathname())) {
    return (
      <main className={`flex w-full min-w-0 flex-1 flex-col ${pad} ${y}`}>
        {children}
      </main>
    );
  }
  return (
    <div className={`mx-auto flex w-full flex-1 gap-10 ${pad} ${wide ? "" : "max-w-7xl"}`}>
      {sidebar}
      <main className={`min-w-0 flex-1 ${y}`}>
        {children}
      </main>
    </div>
  );
}
