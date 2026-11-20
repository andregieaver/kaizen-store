"use server";

import { refresh } from "next/cache";

import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { savePassport } from "@/server/product-passports";
import { PRODUCTS_WORDS } from "@/lib/admin-words/products";

/** Saving a product's passport (D554), as a draft, published, or taken offline (a draft again). `products:write`, checked again by the server. */
export async function savePassportAction(storeSlug: string, productId: string, raw: unknown, publish: boolean) {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false as const, problem: PRODUCTS_WORDS[await actionAdminLang()].passport.title };
  const result = await savePassport(member, String(productId), raw, publish === true);
  if (result.ok) refresh();
  return result;
}
