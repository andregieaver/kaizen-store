"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { siteUrl } from "@/lib/site";
import { startEditPayment, type StartChangePaymentResult } from "@/server/order-edit-pay";
import { resolveShop } from "@/server/shop";

/** What the pay button answers with when it could not send the customer to Stripe: the page says it in words. `null` while nothing has been tried. */
export type ChangeLinkState = { problem: Extract<StartChangePaymentResult, { ok: false }>["problem"] | null };

/**
 * The customer pressed the pay button on a change's pay link (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4 and 4.5). A new Stripe-hosted session for the difference is opened by
 * `startEditPayment()` (earlier sessions closed first, one idempotency key per press, the press limits of 4.1) and the customer is sent to it. Nothing is set in the browser and nothing is
 * ticked: the order's acceptance of the terms stands. The token is the whole access: it is looked up by its hash within this store and under the order's own country, so another store's, a
 * replaced or a malformed one is the same `not_found`. A problem is handed back to the page, which says it in the order's language; a link that is now paid or ended is drawn afresh
 * (`refresh()`), so the customer sees what became of it.
 */
export async function startEditPaymentAction(storeSlug: string, marketSlug: string, token: string): Promise<ChangeLinkState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || typeof token !== "string") return { problem: "not_found" };
  const header = (await headers()).get("origin");
  let origin: string;
  try {
    origin = header ? new URL(header).origin : siteUrl();
  } catch {
    origin = siteUrl();
  }
  const result = await startEditPayment({ store: shop.store, market: shop.market }, token, { origin });
  // To Stripe's own page: an address a server action may redirect to, and the browser loads it as a whole page.
  if (result.ok) redirect(result.url);
  if (result.problem === "paid" || result.problem === "ended" || result.problem === "not_found" || result.problem === "payments_off" || result.problem === "too_small") refresh();
  return { problem: result.problem };
}
