import "server-only";

import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { db } from "@/db/client";
import { PRODUCT_VIEW_DAYS } from "@/lib/automation-kinds";
import { consentCookieName, decodeConsent } from "@/lib/cookie-consent";

import { getCustomer } from "./customers";
import { BROWSE_ON } from "./flows";
import { log } from "./log";

/**
 * What a signed-in subscriber looked at, for browse abandonment (`docs/100-day-challenge.md` D4, D691). The owner's rule: a product view is
 * kept only for a customer who is signed in to the store, subscribed to its emails, and allowed marketing cookies in the store's own consent,
 * only while the store's browse email is on, its automation or a flow that starts from views (switched off, its views go), and never while the browser sends Global Privacy Control or Do Not
 * Track. One row per customer and product holds the latest view; rows go
 * after `PRODUCT_VIEW_DAYS` days (`pruneProductViews()`), and with the customer or the product. Visits stay anonymous (D152): nothing here
 * reaches the visit tables, and nothing is kept for anyone else.
 */

const productId = z.uuid();

/** Records the view when every condition holds; returns whether it was kept. Never throws: a view not kept changes nothing for the shopper. */
export async function recordProductView(storeId: string, product: unknown, headers: Headers): Promise<boolean> {
  try {
    const parsed = productId.safeParse(product);
    if (!parsed.success) return false;
    if (headers.get("sec-gpc") === "1" || headers.get("dnt") === "1") return false;
    const consent = decodeConsent((await cookies()).get(consentCookieName(storeId))?.value);
    if (!consent?.choices.marketing) return false;
    const customer = await getCustomer(storeId);
    if (!customer) return false;
    const kept = await db().execute(sql`
      insert into commerce.customer_product_views (store_id, customer_id, product_id, viewed_at)
      select ${storeId}::uuid, c.id, p.id, now()
      from commerce.customers c
      join commerce.products p on p.store_id = c.store_id and p.id = ${parsed.data}::uuid and p.status = 'active'
      where c.store_id = ${storeId}::uuid and c.id = ${customer.id}::uuid
        -- Only while the store's browse email is on (its automation, or a flow that starts from views): nothing is kept for an email that will not go.
        and ${BROWSE_ON(sql`c.store_id`)}
        and exists (
          select 1 from commerce.marketing_subscribers m
          where m.store_id = c.store_id and lower(m.email) = lower(c.email) and m.status = 'subscribed'
        )
      on conflict (store_id, customer_id, product_id) do update set viewed_at = excluded.viewed_at
      returning product_id
    `);
    return kept.length > 0;
  } catch (error) {
    log("warn", "product_views.record_failed", { storeId }, error);
    return false;
  }
}

/** Daily: views older than `PRODUCT_VIEW_DAYS` days go. Returns how many. */
export async function pruneProductViews(now: Date = new Date()): Promise<number> {
  const rows = await db().execute(sql`
    delete from commerce.customer_product_views where viewed_at < ${now.toISOString()}::timestamptz - make_interval(days => ${PRODUCT_VIEW_DAYS})
    returning product_id
  `);
  return rows.length;
}
