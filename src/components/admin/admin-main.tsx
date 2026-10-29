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
 * `railed`: the page sits beside the rail (docs/admin-style.md 6.3). `focus`: addresses drawn in the `focus` layout, one task in a
 * column of 760 px with nothing beside it (the setup wizard).
 */
export function AdminMain({
  sidebar,
  fullWidth,
  focus,
  wide = false,
  railed = false,
  children,
}: {
  sidebar: ReactNode;
  fullWidth: string;
  focus?: string;
  wide?: boolean;
  railed?: boolean;
  children: ReactNode;
}) {
  const path = usePathname();
  // Beside the rail (layout `rail`) the page sits under a plain top bar: the canvas's own room at the sides, less above.
  const pad = railed ? "px-4 md:px-8" : "px-4";
  const y = railed ? "pt-2 pb-10" : "py-8";
  if (focus && new RegExp(focus).test(path)) {
    return (
      <main id="admin-main" tabIndex={-1} data-admin-layout="focus" className="mx-auto flex w-full max-w-[760px] min-w-0 flex-1 flex-col px-4 pt-2 pb-16">
        {children}
      </main>
    );
  }
  if (new RegExp(fullWidth).test(path)) {
    // The `workspace` layout (docs/admin-style.md 6.3): the tool's own columns take the width; beside the narrowed rail, less room at the sides.
    return (
      <main id="admin-main" tabIndex={-1} data-admin-layout={railed ? "workspace" : undefined} className={`flex w-full min-w-0 flex-1 flex-col ${railed ? "px-4 md:px-6" : pad} ${y}`}>
        {children}
      </main>
    );
  }
  return (
    <div className={`mx-auto flex w-full flex-1 gap-10 ${pad} ${wide ? "" : "max-w-7xl"}`}>
      {sidebar}
      {/* A page's sections (its header, cards, notes) are spaced here, so none touches another however the page groups them. */}
      <main id="admin-main" tabIndex={-1} className={`flex min-w-0 flex-1 flex-col gap-8 ${y}`}>
        {children}
      </main>
    </div>
  );
}
