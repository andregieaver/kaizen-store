"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { savePassport } from "@/server/product-passports";

/** Saving a product's passport (D554), as a draft, published, or taken offline (a draft again). `products:write`, checked again by the server. */
export async function savePassportAction(storeSlug: string, productId: string, raw: unknown, publish: boolean) {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false as const, problem: adminText(await actionAdminLang(), "products").passport.title };
  const result = await savePassport(member, String(productId), raw, publish === true);
  if (result.ok) refresh();
  return result;
}
