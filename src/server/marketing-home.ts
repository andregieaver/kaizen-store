import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { bought } from "./bought-sql";
import { col, typedRow } from "./typed-rows";

const BEST_ROW = z.object({ product_id: col.uuid, title: col.text, sold: col.int });

/**
 * Round 4 (D612): the product sold most often in the last 30 days, by count, for the Marketing page's ready offer ("3 for 2 on …"); null when
 * nothing sold. Paid orders only, copies and cancelled orders left out.
 */
export async function bestSellerByCount(storeId: string): Promise<{ productId: string; title: string; sold: number } | null> {
  const row = await typedRow(BEST_ROW, sql`
    select v.product_id, coalesce(max(l.title), '') as title, sum(l.quantity)::int as sold
    from commerce.order_lines l
    join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
    join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
    where l.store_id = ${storeId}::uuid and o.placed_at > now() - interval '30 days' and o.copied_from is null and ${bought}
    group by v.product_id
    order by sold desc
    limit 1
  `);
  return row ? { productId: row.product_id, title: row.title, sold: row.sold } : null;
}
