"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { adjustStock, setVariantPolicies, type AdjustResult, type PolicyResult } from "@/server/inventory";
import { checkPermission } from "@/server/permissions";

/**
 * The Inventory page's saves (wave 3, D172, `docs/wave-3-inventory.md` 2.2), each for a member with `products:write` and each with the store's slug as its
 * bound first argument. The body is checked again by `adjustInput` / `bulkPolicyInput` in the server functions, which also write the audit entry and refresh
 * the catalogue's tags: nothing the browser sends is trusted, and a figure is written only as a movement with its reason.
 */

/** The refusal before a member is known, in the admin's language (D312 A5). */
const noAccess = async () => adminText(await actionAdminLang(), "inventory").noAccess;

export async function adjustStockAction(storeSlug: string, payload: unknown): Promise<AdjustResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const result = await adjustStock(member, payload, "inventory_page");
  if (result.ok && result.written > 0) refresh();
  return result;
}

export async function setPoliciesAction(storeSlug: string, payload: unknown): Promise<PolicyResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const result = await setVariantPolicies(member, payload);
  if (result.ok && result.changed > 0) refresh();
  return result;
}
