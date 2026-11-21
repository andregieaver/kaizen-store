import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { leadScore, type LeadScore } from "@/lib/lead-score";

import { col, typedRow } from "./typed-rows";

/**
 * A business customer's lead score (email plan M2.8, D865), read in one statement: their quote requests of the last 90 days (D431, not
 * declined, matched by their account or address), their open deals while Deals is on (D464), their presses on links in the store's emails
 * (as a subscriber, by address, M1.3) and the products they looked at while signed in (D691). The score itself is `leadScore()`, in code.
 * Null for a customer who buys for no company (no company name and no company account, D108): the score is for business customers.
 */
export async function customerLeadScore(storeId: string, customer: { customerId: string; email: string }, dealsOn: boolean): Promise<LeadScore | null> {
  const store = sql`${storeId}::uuid`;
  const id = sql`${customer.customerId}::uuid`;
  const row = await typedRow(
    z.object({ business: col.bool, quotes: col.int, open_deals: col.int, presses30: col.int, presses90: col.int, viewed: col.int }),
    sql`
      select
        coalesce((select k.company_name <> '' or k.company_id is not null from commerce.customers k where k.store_id = ${store} and k.id = ${id}), false) as business,
        (select count(*)::int from commerce.draft_orders d
          where d.store_id = ${store} and d.source = 'quote' and d.quote_declined_at is null and d.created_at > now() - interval '90 days'
            and (d.customer_id = ${id} or lower(d.email) = lower(${customer.email}))) as quotes,
        case when ${dealsOn} then (select count(*)::int from commerce.deals x where x.store_id = ${store} and x.customer_id = ${id} and x.status = 'open')
             else 0 end as open_deals,
        (select count(*) filter (where c.clicked_at > now() - interval '30 days')::int from commerce.email_clicks c
           join commerce.marketing_subscribers s on s.store_id = c.store_id and s.id = c.subscriber_id
          where c.store_id = ${store} and lower(s.email) = lower(${customer.email})) as presses30,
        (select count(*) filter (where c.clicked_at > now() - interval '90 days')::int from commerce.email_clicks c
           join commerce.marketing_subscribers s on s.store_id = c.store_id and s.id = c.subscriber_id
          where c.store_id = ${store} and lower(s.email) = lower(${customer.email})) as presses90,
        (select count(*)::int from commerce.customer_product_views v where v.store_id = ${store} and v.customer_id = ${id}) as viewed
    `,
  );
  if (!row?.business) return null;
  return leadScore({
    quotes: row.quotes,
    openDeals: row.open_deals,
    presses30: row.presses30,
    presses90: row.presses90,
    viewed: row.viewed,
  });
}
