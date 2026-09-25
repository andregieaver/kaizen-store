"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The page editor (a page's own address, or a new page) uses the whole width; the rest of the platform admin does not. */
const FULL_WIDTH = /^\/admin\/platform\/pages\/(new|[0-9a-f-]{36})$/;

/**
 * The platform admin's main area. Decided from the address rather than
 * from what the page holds, since pages left behind stay in the document
 * (hidden) for going back.
 */
export function PlatformMain({ children }: { children: ReactNode }) {
  const full = FULL_WIDTH.test(usePathname());
  return (
    <main className={`mx-auto flex w-full flex-1 flex-col gap-8 px-4 py-8 ${full ? "" : "max-w-5xl"}`}>{children}</main>
  );
}
