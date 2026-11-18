"use server";

import { refresh } from "next/cache";

import { t } from "@/lib/i18n";
import { applyAsCreator } from "@/server/creators";
import { getCustomer } from "@/server/customers";
import { resolveSellingShop } from "@/server/shop";

/** What the application form shows after a press: a problem by name, or that it went through. */
export type CreatorFormState = { problem: "invalid" | "channel" | "unverified" | "already" | "off" | null; done?: boolean };

/**
 * A signed-in customer applies to the store's creator programme (D386). The consent kept is the words the form showed, in the market's
 * language; the customer is the session's, never one the form names.
 */
export async function applyCreatorAction(storeSlug: string, marketSlug: string, _state: CreatorFormState, form: FormData): Promise<CreatorFormState> {
  const shop = await resolveSellingShop(String(storeSlug).slice(0, 60), String(marketSlug).slice(0, 40));
  if (!shop) return { problem: "off" };
  const customer = await getCustomer(shop.store.id);
  if (!customer) return { problem: "unverified" };
  const input = {
    name: String(form.get("name") ?? "").slice(0, 200),
    channelUrl: String(form.get("channel") ?? "").slice(0, 400),
    consent: form.get("consent") === "yes",
  };
  const result = await applyAsCreator(shop.store.id, customer.id, input, t(shop.market.lang).creator.consent);
  if (result.ok) {
    refresh();
    return { problem: null, done: true };
  }
  const problem = result.problem;
  return { problem: problem === "channel" || problem === "unverified" || problem === "already" || problem === "off" ? problem : "invalid" };
}
