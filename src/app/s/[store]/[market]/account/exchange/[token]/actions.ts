"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { siteUrl } from "@/lib/site";
import { confirmExchange, declineExchange, startExchangePayment, type ConfirmResult, type StartExchangePaymentResult } from "@/server/exchange-pay";
import { resolveShop } from "@/server/shop";

/** What a press on the exchange page answers with when it did not move the exchange on: the page says it in words. `null` while nothing went wrong. */
export type ExchangeAnswerState = {
  problem: Extract<ConfirmResult, { ok: false }>["problem"] | Extract<StartExchangePaymentResult, { ok: false }>["problem"] | null;
};

/**
 * The customer's presses on the exchange page (wave 3, D239, `docs/wave-3-exchanges.md` 2.1). Thin: the shop is resolved from the address
 * (`resolveShop()`) and the server module does the rest (`src/server/exchange-pay.ts`), finding the exchange by the token's hash within this store and
 * under the original order's own country, so another store's, a replaced or a malformed token is the same `not_found`. A press that moved the exchange on
 * draws the page afresh in its new state (`refresh()`); nothing is set in the browser.
 */

/** *Confirm the exchange*: the customer's own express agreement (CRD Art. 13(1)). The terms tick, in `checkbox` mode, is a plain field checked again on the server. */
export async function confirmExchangeAction(storeSlug: string, marketSlug: string, token: string, _previous: ExchangeAnswerState, form: FormData): Promise<ExchangeAnswerState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || typeof token !== "string") return { problem: "not_found" };
  const result = await confirmExchange({ store: shop.store, market: shop.market }, token, { termsTicked: form.get("terms") === "1" });
  if (result.ok || result.problem === "ended" || result.problem === "not_found") refresh();
  return { problem: result.ok ? null : result.problem };
}

/** *No thanks, refund me instead*: the proposal ends and the return is refunded as usual. */
export async function declineExchangeAction(storeSlug: string, marketSlug: string, token: string): Promise<ExchangeAnswerState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || typeof token !== "string") return { problem: "not_found" };
  const result = await declineExchange({ store: shop.store, market: shop.market }, token);
  refresh();
  return { problem: result.ok ? null : result.problem };
}

/** *Pay {Δ}*: one new Stripe-hosted session for the difference, and the customer is sent to it. */
export async function startExchangePaymentAction(storeSlug: string, marketSlug: string, token: string): Promise<ExchangeAnswerState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || typeof token !== "string") return { problem: "not_found" };
  const header = (await headers()).get("origin");
  let origin: string;
  try {
    origin = header ? new URL(header).origin : siteUrl();
  } catch {
    origin = siteUrl();
  }
  const result = await startExchangePayment({ store: shop.store, market: shop.market }, token, { origin });
  // To Stripe's own page: the browser loads it as a whole page.
  if (result.ok) redirect(result.url);
  if (result.problem !== "limit" && result.problem !== "payment_error" && result.problem !== "processing") refresh();
  return { problem: result.problem };
}
