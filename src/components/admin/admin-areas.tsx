import type { ReactNode } from "react";

import { adminTexts, type AdminArea } from "@/lib/admin-text";
import { requestAdminLang } from "@/server/admin-request-lang";

import { AdminTextScope } from "./admin-text";

/**
 * Hands the client parts under it the areas they read, in the signed-in account's language (D312 A4), for a page that draws another
 * area's parts (the media library's, the fonts form's): an area not handed down is drawn in English whatever the account's language,
 * and makes `useAdminText()` reach for the whole English catalogue (PSI PERF-01, `docs/performance.md`).
 */
export async function AdminAreas({ areas, children }: { areas: readonly AdminArea[]; children: ReactNode }) {
  return <AdminTextScope texts={adminTexts(await requestAdminLang(), areas)}>{children}</AdminTextScope>;
}
