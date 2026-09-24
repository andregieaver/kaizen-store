"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { changeLine } from "@/server/cart";
import { resolveShop } from "@/server/shop";

const lineInput = z.object({
  store: z.string(),
  market: z.string(),
  variantId: z.uuid(),
  quantity: z.coerce.number().int().min(0).max(MAX_LINE_QUANTITY),
});

export type AddToCartState = {
  outcome: "idle" | "added" | "capped" | "unavailable" | "error";
  quantity: number;
};

async function parse(formData: FormData) {
  const parsed = lineInput.safeParse({
    store: formData.get("store"),
    market: formData.get("market"),
    variantId: formData.get("variantId"),
    quantity: formData.get("quantity") ?? 1,
  });
  if (!parsed.success) return null;
  const shop = await resolveShop(parsed.data.store, parsed.data.market);
  return shop
    ? {
        shop: { storeId: shop.store.id, market: shop.market },
        variantId: parsed.data.variantId,
        quantity: parsed.data.quantity,
      }
    : null;
}

/** Adds one or more units from a product page. */
export async function addToCart(
  _previous: AddToCartState,
  formData: FormData,
): Promise<AddToCartState> {
  const input = await parse(formData);
  if (!input || input.quantity < 1) return { outcome: "error", quantity: 0 };
  const result = await changeLine(input.shop, input.variantId, input.quantity, "add");
  refresh();
  return result.outcome === "removed"
    ? { outcome: "error", quantity: 0 }
    : { outcome: result.outcome, quantity: result.quantity };
}

/** Sets a cart line's quantity; 0 removes the line. */
export async function updateCartLine(formData: FormData): Promise<void> {
  const input = await parse(formData);
  if (!input) return;
  await changeLine(input.shop, input.variantId, input.quantity, "set");
  refresh();
}
