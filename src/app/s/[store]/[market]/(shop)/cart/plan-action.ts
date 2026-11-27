"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { marketPath } from "@/lib/paths";
import { choosePlan } from "@/server/cart";
import { resolveSellingShop } from "@/server/shop";

const planInput = z.object({ store: z.string(), market: z.string(), variantId: z.uuid(), sellingPlanId: z.uuid() });

/**
 * *Choose plan* on a pricing table's card (D912): the plan at the billing period chosen goes in the cart as its one plan (`choosePlan()`), and
 * the shopper goes to the cart, where the subscription's terms are agreed to and checkout starts. A plain form, so it works before any script.
 * Kept apart from the cart's other actions so a page with a pricing table loads this file alone, and only where a store's plans are drawn.
 */
export async function choosePlanAction(formData: FormData): Promise<void> {
  const parsed = planInput.safeParse({
    store: formData.get("store"),
    market: formData.get("market"),
    variantId: formData.get("variantId"),
    sellingPlanId: formData.get("sellingPlanId"),
  });
  if (!parsed.success) redirect("/");
  const shop = await resolveSellingShop(parsed.data.store, parsed.data.market);
  if (!shop) redirect("/");
  await choosePlan({ storeId: shop.store.id, market: shop.market }, parsed.data.variantId, parsed.data.sellingPlanId);
  redirect(marketPath(shop.store.slug, shop.market.slug, "/cart"));
}
