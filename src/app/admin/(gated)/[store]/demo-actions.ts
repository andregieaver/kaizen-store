"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { removalWords } from "@/lib/demo-content";
import { redirectsTag } from "@/lib/redirects";
import { catalogTag } from "@/server/catalog";
import { removeDemoContent } from "@/server/demo-content";
import { pagesTag } from "@/server/pages";
import { checkOwnerRole } from "@/server/permissions";
import { storeTag } from "@/server/stores";
import { termsTag } from "@/server/taxonomy";

/**
 * *Remove demo content* on the store's Home (`docs/theme-showcase-phase-1.md` step 4b): owners only, one press. Products are archived,
 * pages and terms deleted and the menus cleaned in one transaction; the answer names what stayed.
 */
export async function removeDemoContentAction(storeSlug: string): Promise<FormState> {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return { status: "error", messages: [adminText("en", "home").demo.onlyOwner] };
  const { account, store } = owner;
  const w = adminText(adminLangOf(account.adminLocale), "home").demo;
  let result;
  try {
    result = await removeDemoContent(account.id, store.id, store.localization.locales[0] ?? "en");
  } catch (error) {
    console.error("[demo content] removal failed", error);
    return { status: "error", messages: [w.failed] };
  }
  updateTag(storeTag(store.slug));
  updateTag(catalogTag(store.id));
  updateTag(pagesTag(store.id));
  for (const contentType of ["product", "page", "article"] as const) updateTag(termsTag({ storeId: store.id, contentType }));
  updateTag(redirectsTag(store.id));
  return { status: "ok", messages: removalWords(result.removed, result.kept, w) };
}
