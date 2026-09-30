"use server";

import { captureAffiliate } from "@/server/affiliates";
import { getOpenStore } from "@/server/stores";

/**
 * A visit to a store's referral link (D131): says whether the code is a live affiliate's of the store, and counts the
 * visit for the day (a number, nothing about the visitor). It sets nothing: the browser keeps the code in memory, and in
 * the store's cookie only if the visitor allowed it.
 */
export async function captureAffiliateAction(storeSlug: string, code: string): Promise<boolean> {
  const store = await getOpenStore(String(storeSlug ?? "").slice(0, 60));
  if (!store) return false;
  return captureAffiliate(store.id, String(code ?? "").slice(0, 32));
}
