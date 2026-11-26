"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { ADMIN_USE_COOKIE } from "@/lib/admin-use-cookie";

/**
 * Loads the admin heatmaps' collector (D895 phase 3b) only for a person whose browser says they allowed it (the choice cookie `h` or `hr`),
 * and tells it each screen as the person moves through the admin. Draws nothing; for everyone else it loads nothing at all.
 */
export function AdminUseSignals() {
  const pathname = usePathname();
  useEffect(() => {
    let value: string | undefined;
    try {
      value = document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${ADMIN_USE_COOKIE}=`))
        ?.slice(ADMIN_USE_COOKIE.length + 1);
    } catch {
      return;
    }
    if (value !== "h" && value !== "hr") return;
    void import("@/components/signals/admin-use-watch").then((m) => m.watchScreen(pathname)).catch(() => {});
  }, [pathname]);
  return null;
}
