import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { breakSteps, type BreakStep } from "@/lib/price-breaks";

import { col, typedRows } from "./typed-rows";

/**
 * Price breaks on the product page (wave 6 unit E2, D323, `docs/wave-6-catalogue.md` E.2): for each variant, the price each at its minimum and at
 * each of its product's breaks, asked of `commerce.line_price()` for this buyer, so the table is what the cart charges. Read per request inside the
 * buy part (a buyer's price lists differ), never cached; goods and bundles only. A variant whose breaks lower nothing has no table.
 */
const STEP_ROW = z.object({ variant_id: col.uuid, quantity: col.int, amount_minor: col.minor });

export async function priceBreaksFor(storeId: string, customerId: string | null, variantIds: string[], marketCode: string): Promise<Map<string, BreakStep[]>> {
  if (variantIds.length === 0) return new Map();
  const rows = await typedRows(STEP_ROW, sql`
    select v.id as variant_id, q.quantity, coalesce(lp.amount_minor, cp.amount_minor) as amount_minor
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.kind in ('goods', 'bundle')
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${marketCode}
    -- From the buyer's minimum (a price list's rule, else the variant's, E3), then each break the product or the buyer's lists give.
    cross join lateral commerce.quantity_rule(v.store_id, ${customerId}::uuid, v.id) qr
    cross join lateral (
      select qr.min_quantity as quantity
      union
      select b.from_quantity from commerce.price_breaks b
      where b.store_id = v.store_id and b.product_id = v.product_id and (b.variant_id is null or b.variant_id = v.id) and b.from_quantity > qr.min_quantity
      union
      select lb.from_quantity from commerce.buyer_lists(v.store_id, ${customerId}::uuid) as mine(id)
      join commerce.price_list_breaks lb on lb.store_id = v.store_id and lb.list_id = mine.id and lb.variant_id = v.id
      where ${customerId}::uuid is not null and lb.from_quantity > qr.min_quantity
    ) q
    left join lateral commerce.line_price(v.store_id, ${customerId}::uuid, v.id, ${marketCode}, cp.amount_minor, q.quantity) lp on true
    where v.store_id = ${storeId}::uuid and v.id = any(${`{${variantIds.join(",")}}`}::uuid[])
      -- Only variants with a break to show: nothing is priced for a product without any.
      and (
        exists (
          select 1 from commerce.price_breaks b
          where b.store_id = v.store_id and b.product_id = v.product_id and (b.variant_id is null or b.variant_id = v.id)
        )
        or (${customerId}::uuid is not null and exists (
          select 1 from commerce.price_list_breaks lb
          where lb.store_id = v.store_id and lb.variant_id = v.id and lb.list_id in (select id from commerce.buyer_lists(v.store_id, ${customerId}::uuid) as mine(id))
        ))
      )
  `);
  const byVariant = new Map<string, BreakStep[]>();
  for (const row of rows) {
    const list = byVariant.get(row.variant_id) ?? [];
    list.push({ from: row.quantity, amountMinor: row.amount_minor });
    byVariant.set(row.variant_id, list);
  }
  const out = new Map<string, BreakStep[]>();
  for (const [variantId, prices] of byVariant) {
    const steps = breakSteps(prices);
    if (steps.length > 0) out.set(variantId, steps);
  }
  return out;
}
