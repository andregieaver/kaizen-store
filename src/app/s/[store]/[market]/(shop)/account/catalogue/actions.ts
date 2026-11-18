"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { MAX_ORDER_QUANTITY } from "@/lib/cart";
import { changeLine } from "@/server/cart";
import { resolveSellingShop } from "@/server/shop";

/**
 * Adds a variant from Your catalogue (D321 C.3) to the cart. The cart's own add checks the variant is sold to this buyer (`offeredTo()` with the
 * signed-in customer) and caps the quantity by stock, as from a product page.
 */
export async function addFromCatalogueAction(storeSlug: string, marketSlug: string, variantId: string, form: FormData): Promise<void> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  const quantity = z.coerce.number().int().min(1).max(MAX_ORDER_QUANTITY).safeParse(form.get("quantity") ?? 1);
  if (!shop || !z.uuid().safeParse(variantId).success || !quantity.success) return;
  await changeLine({ storeId: shop.store.id, market: shop.market }, variantId, quantity.data, "add", null);
  refresh();
}
