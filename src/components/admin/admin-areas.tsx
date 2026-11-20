import type { ReactNode } from "react";

import { areaTexts } from "@/lib/admin-area";
import type { AdminLang } from "@/lib/admin-lang";
import type { AdminArea, AdminAreaMessages } from "@/lib/admin-text";
import { requestAdminLang } from "@/server/admin-request-lang";

import { AdminTextScope } from "./admin-text";

/**
 * Hands the client parts under it the areas they read, in the signed-in account's language (D312 A4), for a page that draws another
 * area's parts (the media library's, the fonts form's): an area not handed down is drawn in English whatever the account's language,
 * and makes `useAdminText()` reach for the whole English catalogue (PSI PERF-01, `docs/performance.md`). It takes the areas' modules
 * (`areas={{ website: WEBSITE_WORDS }}`, bloat review step 2.25), so it loads only the areas named.
 */
export async function AdminAreas({ areas, children }: { areas: { [A in AdminArea]?: Record<AdminLang, AdminAreaMessages[A]> }; children: ReactNode }) {
  return <AdminTextScope texts={areaTexts(await requestAdminLang(), areas) as Partial<AdminAreaMessages>}>{children}</AdminTextScope>;
}
