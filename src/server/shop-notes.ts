import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { shown, type Market } from "@/lib/markets";
import { cartSaving, freeShippingState, type FreeShippingState, type SavingLine } from "@/lib/shop-notes";

import type { Cart } from "./cart";
import { getCheckoutInfo } from "./orders";
import { col, typedRows } from "./typed-rows";

/** The market's flat rate (amount and free-shipping threshold, in the currency shown); null without one. */
export async function marketRate(storeId: string, market: Market): Promise<{ amountMinor: number; freeOverMinor: number | null } | null> {
  return (await getCheckoutInfo(storeId, market.code, market)).shipping;
}

/** Where an empty cart stands: the threshold to offer, or nothing. */
export async function emptyFreeShipping(storeId: string, market: Market): Promise<FreeShippingState | null> {
  return freeShippingState(await marketRate(storeId, market), 0, true, true);
}

/**
 * What a cart saves today (D557): each line against its variant's lowest price of the last 30 days in the market (`current_prices`,
 * converted to the currency shown as prices are), never for a line priced by a list, a break, a subscription, a booking or a gift card,
 * plus `discountMinor`, the cart's discounts as `cartSummary()` worked them out.
 */
export async function cartSavingOf(storeId: string, market: Market, cart: Cart, discountMinor: number) {
  const ids = [...new Set(cart.lines.map((line) => line.variantId))];
  const priors = ids.length
    ? await typedRows(
        z.object({ variant_id: col.uuid, prior: col.minorOrNull }),
        sql`
          select cp.variant_id, cp.prior_30d_minor as prior
          from commerce.current_prices cp
          join commerce.product_variants v on v.id = cp.variant_id
          join commerce.products p on p.id = v.product_id
          where p.store_id = ${storeId}::uuid and cp.market_code = ${market.code}
            and cp.variant_id = any(${`{${ids.join(",")}}`}::uuid[])
        `,
      )
    : [];
  const prior = new Map(priors.map((row) => [row.variant_id, row.prior === null ? null : shown(market, row.prior)]));
  const lines: SavingLine[] = cart.lines
    .filter((line) => line.status !== "unavailable" && line.unitPriceMinor !== null)
    .map((line) => ({
      unitPriceMinor: line.unitPriceMinor as number,
      quantity: line.quantity,
      priorMinor: prior.get(line.variantId) ?? null,
      ownPrice: line.priceListId !== null || line.breakFrom !== null || line.plan !== null || line.booking !== null || line.giftCard !== null,
    }));
  return cartSaving(lines, discountMinor);
}
