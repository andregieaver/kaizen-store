"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { marketPath, storeOrigin } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { getShopperOrder } from "@/server/orders";
import { startTermsPayment } from "@/server/payment-terms";
import { resolveAfterSaleShop } from "@/server/shop";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * *Pay now* on the order page of an order bought on payment terms (D293): the order's own key (the page's `session_id`) is checked as the page checks it,
 * then Stripe's hosted page is opened for the balance and the buyer is sent there with a full page load. A refusal comes back to the order page, which says
 * it (`pay=failed`); a paid order simply shows itself paid. No zod and no state in the browser: the order page is a pay route.
 */
export async function payOnTermsAction(storeSlug: string, marketSlug: string, orderId: string, sessionId: string): Promise<void> {
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop || !UUID.test(orderId) || typeof sessionId !== "string" || sessionId.length > 300) redirect("/");
  const order = await getShopperOrder(shop.store.id, orderId, sessionId);
  const back = `${storeOrigin(shop.store.slug) ?? ""}${marketPath(shop.store.slug, shop.market.slug, `/order/${orderId}`)}?session_id=${encodeURIComponent(sessionId)}`;
  if (!order) redirect(back);
  const header = (await headers()).get("origin");
  const origin = header ? new URL(header).origin : siteUrl();
  const started = await startTermsPayment({ store: shop.store, market: shop.market }, orderId, origin);
  if (started.ok) redirect(started.url);
  redirect(started.problem === "paid" ? back : `${back}&pay=failed`);
}
