import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { LOW_STOCK_THRESHOLD } from "@/lib/pricing";
import { ruleForKind } from "@/lib/quantity-rules";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { tileStockFact, tileStockText, type TileFact, type TileFactsAnswer, type TileVariant } from "@/lib/shop-tiles";
import { UNLIMITED } from "@/lib/stock-availability";
import { canOffer } from "@/lib/stock-words";

import { getVariantStock } from "./catalog";
import { getProductSettings } from "./product-settings";
import { col, typedRows } from "./typed-rows";

/**
 * The facts a grid's product tiles show (D557, `src/lib/shop-tiles.ts`): each product's stock in words and, when it can be bought from its
 * tile, the variant to add and its quantity rule, with the store's settings. Per request: stock is never cached. Only the store's active
 * products with a price in the market are answered; any other id is left out.
 */
export async function tileFacts(storeId: string, market: Pick<Market, "code" | "lang" | "locale">, productIds: readonly string[], buttons = true): Promise<TileFactsAnswer> {
  const marketCode = market.code;
  const m = t(market.lang);
  const ids = productIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const settings = await getProductSettings(storeId);
  if (ids.length === 0) return { settings, facts: {}, buttons };
  const rows = await typedRows(
    z.object({
      product_id: col.uuid,
      variant_id: col.uuid,
      kind: col.text,
      subscription_only: col.bool,
      price_on_request: col.bool,
      min_quantity: col.int,
      max_quantity: col.int.nullable(),
      quantity_step: col.int,
      variants: col.int,
    }),
    sql`
      select p.id as product_id, v.id as variant_id, p.kind, p.subscription_only, p.price_on_request,
        v.min_quantity, v.max_quantity, v.quantity_step,
        (count(*) over (partition by p.id))::int as variants
      from commerce.products p
      join commerce.product_variants v on v.product_id = p.id and v.active
      where p.store_id = ${storeId}::uuid and p.status = 'active'
        and p.id = any(${`{${ids.join(",")}}`}::uuid[])
        and exists (select 1 from commerce.current_prices cp where cp.variant_id = v.id and cp.market_code = ${marketCode})
    `,
  );
  const stock = await getVariantStock(storeId, rows.map((r) => r.variant_id));
  const byProduct = new Map<string, typeof rows>();
  for (const row of rows) byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), row]);
  const facts: Record<string, TileFact> = {};
  for (const [productId, variants] of byProduct) {
    const seen: TileVariant[] = variants.map((v) => {
      const s = stock.get(v.variant_id);
      const unlimited = s === UNLIMITED || (s !== undefined && s.inStock === Number.MAX_SAFE_INTEGER);
      return { inStock: s?.inStock ?? 0, canOffer: canOffer(s), backorderDays: s?.backorderDays ?? null, preorderUntil: s?.preorderUntil ?? null, unlimited };
    });
    const only = variants.length === 1 ? variants[0] : null;
    // Bought from its tile only when nothing must be chosen first: one variant of goods or a bundle, no subscription it must have, a price shown.
    const simple = only && (only.kind === "goods" || only.kind === "bundle") && !only.subscription_only && !only.price_on_request;
    const said = tileStockFact(seen, LOW_STOCK_THRESHOLD);
    facts[productId] = {
      stock: said && { kind: said.kind, text: tileStockText(said, m, market.locale) },
      // A sold-out product says so and offers nothing to press: its tile still links to its page, where a back-in-stock request is.
      buy: simple && seen[0].canOffer ? { variantId: only.variant_id, rule: ruleForKind(only.kind, only), canBuy: true } : null,
    };
  }
  return { settings, facts, buttons };
}
