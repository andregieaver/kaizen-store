"use server";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { requirePlatformAdmin } from "@/server/auth";
import { copySiteIntoHouse } from "@/server/house-site";

/** Copies Kaizena Flow's site into its own store (D469, step 3 of the plan): the live site does not change. */
export async function copySiteAction(): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").houseSite;
  const result = await copySiteIntoHouse(admin);
  if (!result.ok) return { status: "error", messages: [result.problem === "no_store" ? w.noStore : w.failed] };
  const pages = result.counts.page ?? 0;
  // Settings changed in the store stay the store's (D474): said, so nobody wonders why the live site's did not come.
  const kept = result.counts.settings_kept ?? 0;
  return { status: "ok", messages: [fillWords(w.copied, { pages: String(pages) }), ...(kept > 0 ? [countWords(kept, w.kept)] : [])] };
}
