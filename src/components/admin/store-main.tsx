"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The page editor (a page's own address, or a new page) uses the whole width, without the settings sidebar (D53). */
const FULL_WIDTH = /^\/admin\/[^/]+\/pages\/(new|[0-9a-f-]{36})$/;

/**
 * A store admin's main area beside its settings sidebar; decided from the
 * address, as `PlatformMain` is.
 */
export function StoreMain({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  if (FULL_WIDTH.test(usePathname())) {
    return <main className="flex w-full min-w-0 flex-1 flex-col px-4 py-8">{children}</main>;
  }
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 gap-10 px-4">
      {sidebar}
      <main className="min-w-0 flex-1 py-8">{children}</main>
    </div>
  );
}
