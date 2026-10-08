"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { checkPermission } from "@/server/permissions";
import { catalogTag } from "@/server/catalog";
import { pagesTag } from "@/server/pages";
import { STORES_TAG } from "@/server/seo";
import { setMarkets } from "@/server/setup";
import { forgetStoreFacts } from "@/server/redirect-resolve";
import { storeTag } from "@/server/stores";

/**
 * The countries the store sells to (D178), from the Countries settings (`settings:write`), through the setup wizard's `setMarkets()`. The
 * storefront, its catalogue, sitemap and pages follow, so their caches are cleared.
 */
export async function saveCountriesSettingsAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await checkPermission(storeSlug, "settings:write");
  if (!owner) return { status: "error", messages: ["You may not change the store's settings."] };
  const codes = formData
    .getAll("country")
    .map(String)
    .filter((code) => /^[A-Z]{2}$/.test(code));
  const result = await setMarkets(owner, codes);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(storeTag(owner.store.slug));
  // The shape of its addresses (D181), as the proxy reads it.
  forgetStoreFacts(owner.store.slug);
  updateTag(catalogTag(owner.store.id));
  updateTag(pagesTag(owner.store.id));
  updateTag(STORES_TAG);
  refresh();
  return { status: "ok", messages: [result.note ?? "Countries saved."] };
}
