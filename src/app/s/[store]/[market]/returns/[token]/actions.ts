"use server";

import { refresh } from "next/cache";

import { recordExchangeWish } from "@/server/exchanges";
import { resolveAfterSaleShop } from "@/server/shop";

/** What sending a wish answered: `sent`, or the problem the field shows (`empty`, `too_long`, `too_many_lines`, `failed`). */
export type WishState = { sent: boolean; problem: "empty" | "too_long" | "too_many_lines" | "failed" | null };

/**
 * *Ask for an exchange* on a return's status page (wave 3, D239, `docs/wave-3-exchanges.md` 2.1). Thin: the shop as the status page resolves it, then
 * `recordExchangeWish()`, which finds the return by its own token among the store's, cleans the words with the same check as the field, keeps the wish once
 * and tells the store. A wish is not an agreement; nothing is applied from it. The page is drawn afresh (`refresh()`) so it says the wish was sent.
 */
export async function sendExchangeWishAction(storeSlug: string, marketSlug: string, token: string, _previous: WishState, form: FormData): Promise<WishState> {
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop || typeof token !== "string") return { sent: false, problem: "failed" };
  const note = form.get("note");
  const result = await recordExchangeWish(shop.store.id, token, { note: typeof note === "string" ? note : "" });
  if (result.ok || result.problem === "wish_made") {
    refresh();
    return { sent: true, problem: null };
  }
  if (result.problem === "invalid" && (result.message === "empty" || result.message === "too_long" || result.message === "too_many_lines")) return { sent: false, problem: result.message };
  refresh();
  return { sent: false, problem: "failed" };
}
