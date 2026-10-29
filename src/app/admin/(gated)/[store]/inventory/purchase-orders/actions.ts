"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { cancelPurchaseOrder, createPurchaseOrder, placePurchaseOrder, receivePurchaseOrder } from "@/server/purchase-orders";
import type { DocumentResult } from "@/server/stock-transfers";

/**
 * The purchase orders pages' steps (wave 11 unit D, D383), each with the store's slug as its bound first argument and `products:write`; the
 * server functions check it again and hold every rule (never more in than was ordered, the cost converted at the store's rates).
 */

const refused = async (): Promise<DocumentResult> => ({ ok: false, problems: [adminText(await actionAdminLang(), "inventory").noAccess] });

export async function createPurchaseOrderAction(storeSlug: string, raw: unknown): Promise<DocumentResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return refused();
  const result = await createPurchaseOrder(member, raw);
  if (result.ok) refresh();
  return result;
}

export async function placePurchaseOrderAction(storeSlug: string, id: string): Promise<DocumentResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return refused();
  const result = await placePurchaseOrder(member, String(id));
  if (result.ok) refresh();
  return result;
}

export async function receivePurchaseOrderAction(storeSlug: string, id: string, raw: unknown): Promise<DocumentResult & { received?: number; costsKept?: number }> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return refused();
  const result = await receivePurchaseOrder(member, String(id), raw);
  if (result.ok) refresh();
  return result;
}

export async function cancelPurchaseOrderAction(storeSlug: string, id: string): Promise<DocumentResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return refused();
  const result = await cancelPurchaseOrder(member, String(id));
  if (result.ok) refresh();
  return result;
}
