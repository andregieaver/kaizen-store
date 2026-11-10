"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkOwnerRole, checkPermission } from "@/server/permissions";
import { saveDropShipSupplier, setVariantsSupplier, stopDropShipping } from "@/server/suppliers";

/**
 * The Suppliers pages' steps (drop shipping, D540), each with the store's slug as its bound first argument. Adding, editing and marking products are for
 * a member with `products:write`; stopping a supplier takes its stock off sale, so it is the OWNER's (`checkOwnerRole`, checked again by the server).
 */

const noAccess = async () => adminText(await actionAdminLang(), "inventory").noAccess;

export type SupplierForm = {
  name: string;
  orderEmail: string;
  shipsFrom: string;
  orderLanguage: string;
  dispatchDays: string;
  orderMethod: string;
  returnAddress: string;
  orderNote: string;
};

export async function saveSupplierAction(storeSlug: string, form: SupplierForm, id: string | null) {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false as const, problem: await noAccess() };
  const result = await saveDropShipSupplier(member, form, typeof id === "string" ? id : null);
  if (result.ok) refresh();
  return result;
}

export async function markVariantsAction(storeSlug: string, supplierId: string, variantIds: string[], on: boolean) {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false as const, problem: await noAccess() };
  const result = await setVariantsSupplier(member, String(supplierId), Array.isArray(variantIds) ? variantIds.map(String) : [], on === true);
  if (result.ok) refresh();
  return result;
}

export async function stopSupplierAction(storeSlug: string, supplierId: string) {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false as const, problem: await noAccess() };
  const result = await stopDropShipping(member, String(supplierId));
  if (result.ok) refresh();
  return result;
}
