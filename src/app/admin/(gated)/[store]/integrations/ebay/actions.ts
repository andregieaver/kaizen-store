"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { EBAY_STATE_COOKIE, EBAY_STATE_MINUTES, EBAY_STATE_PATH, chooseForEbay, disconnectEbay, markEbayOrderSent, saveEbaySettings, startEbayConnect } from "@/server/ebay";
import { checkOwnerRole } from "@/server/permissions";

/**
 * eBay (D555): the owner's actions. A connection sells in the store's name and brings its buyers' addresses here, so only an owner connects,
 * sets it up, lists products, marks its orders sent or disconnects it, as with every integration (D41).
 */
const refusal = async () => ({ ok: false as const, problem: adminText(await actionAdminLang(), "inventory").noAccess });

export async function connectEbayAction(storeSlug: string) {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return refusal();
  const start = await startEbayConnect(owner);
  if (!start.ok) return { ok: false as const, problem: start.problem === "off" ? "eBay is not set up on Kaizena Flow yet." : "Only the owner can connect eBay." };
  (await cookies()).set(EBAY_STATE_COOKIE, start.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: EBAY_STATE_PATH, maxAge: EBAY_STATE_MINUTES * 60 });
  redirect(start.url);
}

export async function saveEbaySettingsAction(storeSlug: string, raw: Record<string, string>) {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return refusal();
  const result = await saveEbaySettings(owner, raw);
  if (result.ok) refresh();
  return result;
}

export async function chooseForEbayAction(storeSlug: string, variantIds: string[], on: boolean) {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return refusal();
  const result = await chooseForEbay(owner, Array.isArray(variantIds) ? variantIds.map(String) : [], on === true);
  if (result.ok) refresh();
  return result;
}

export async function markEbaySentAction(storeSlug: string, orderId: string, carrier: string, tracking: string) {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return refusal();
  const result = await markEbayOrderSent(owner, String(orderId), String(carrier), String(tracking));
  if (result.ok) refresh();
  return result;
}

export async function disconnectEbayAction(storeSlug: string) {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return refusal();
  const result = await disconnectEbay(owner);
  if (result.ok) refresh();
  return result;
}
