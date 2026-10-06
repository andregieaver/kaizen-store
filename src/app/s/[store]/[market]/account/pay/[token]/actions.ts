"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { siteUrl } from "@/lib/site";
import { startDraftPayment, type StartPaymentResult } from "@/server/draft-pay";
import { resolveShop } from "@/server/shop";

/** What the pay button answers with when it could not send the buyer to Stripe: the page says it in words. `null` while nothing has been tried. */
export type PayLinkState = { problem: Extract<StartPaymentResult, { ok: false }>["problem"] | null };

/**
 * The buyer pressed the pay button on a draft order's pay link (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1). The terms tick is read from the form (`terms`), the acceptance is recorded and a
 * new Stripe-hosted session is opened by `startDraftPayment()`, and the buyer is sent to it. Nothing is set in the browser. The token is the whole access to the order: it is looked up by its hash
 * within this store, so a token of another store, a replaced or a malformed one is the same `not_found`. A problem is handed back to the page, which says it in the order's language; a page
 * that is now paid or expired is drawn afresh (`refresh()`), so the buyer sees what became of the link.
 */
export async function startDraftPaymentAction(storeSlug: string, marketSlug: string, token: string, _state: PayLinkState, form: FormData): Promise<PayLinkState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || typeof token !== "string") return { problem: "not_found" };
  const header = (await headers()).get("origin");
  let origin: string;
  try {
    origin = header ? new URL(header).origin : siteUrl();
  } catch {
    origin = siteUrl();
  }
  const result = await startDraftPayment({ store: shop.store, market: shop.market }, token, { termsTicked: form.get("terms") === "1", origin });
  // To Stripe's own page: an address a server action may redirect to, and the browser loads it as a whole page.
  if (result.ok) redirect(result.url);
  if (result.problem === "paid" || result.problem === "expired" || result.problem === "not_found" || result.problem === "payments_off") refresh();
  return { problem: result.problem };
}
