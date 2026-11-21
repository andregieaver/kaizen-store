import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { leadScore, type LeadScore } from "@/lib/lead-score";

import { col, typedRow, typedRows } from "./typed-rows";

const LEAD_ROW = z.object({ email: col.text, quotes: col.int, open_deals: col.int, presses30: col.int, presses90: col.int, viewed: col.int });

/**
 * The facts of business customers' lead scores (email plan M2.8, D865), one row each, in one statement: their quote requests of the last 90
 * days (D431, not declined, by their account or address), their open deals while Deals is on (D464), their presses on links in the store's
 * emails (as a subscriber, by address, M1.3) and the products they looked at while signed in (D691). Only customers who buy for a company
 * (a company name or a company account, D108); `filter` narrows them further, on the customers row `c`. The page and segments both read
 * here, so a score is the same wherever it shows.
 */
async function leadRows(storeId: string, filter: SQL, dealsOn: boolean) {
  const store = sql`${storeId}::uuid`;
  return typedRows(
    LEAD_ROW,
    sql`
      select lower(c.email) as email,
        (select count(*)::int from commerce.draft_orders d
          where d.store_id = c.store_id and d.source = 'quote' and d.quote_declined_at is null and d.created_at > now() - interval '90 days'
            and (d.customer_id = c.id or lower(d.email) = lower(c.email))) as quotes,
        case when ${dealsOn} then (select count(*)::int from commerce.deals x where x.store_id = c.store_id and x.customer_id = c.id and x.status = 'open')
             else 0 end as open_deals,
        coalesce(p.presses30, 0) as presses30, coalesce(p.presses90, 0) as presses90,
        (select count(*)::int from commerce.customer_product_views v where v.store_id = c.store_id and v.customer_id = c.id) as viewed
      from commerce.customers c
      left join lateral (
        select count(*) filter (where k.clicked_at > now() - interval '30 days')::int as presses30,
               count(*) filter (where k.clicked_at > now() - interval '90 days')::int as presses90
          from commerce.email_clicks k
          join commerce.marketing_subscribers s on s.store_id = k.store_id and s.id = k.subscriber_id
         where k.store_id = c.store_id and lower(s.email) = lower(c.email)
      ) p on true
      where c.store_id = ${store} and c.email <> '' and (c.company_name <> '' or c.company_id is not null) and ${filter}
    `,
  );
}

const scoreOf = (r: z.output<typeof LEAD_ROW>): LeadScore =>
  leadScore({ quotes: r.quotes, openDeals: r.open_deals, presses30: r.presses30, presses90: r.presses90, viewed: r.viewed });

/** One customer's score (the card on their page); null for one who buys for no company: the score is for business customers. */
export async function customerLeadScore(storeId: string, customerId: string, dealsOn: boolean): Promise<LeadScore | null> {
  const [row] = await leadRows(storeId, sql`c.id = ${customerId}::uuid`, dealsOn);
  return row ? scoreOf(row) : null;
}

/** Every business customer's score by lower-case address, for segments' "lead score" condition (`readSegmentFacts()`). */
export async function leadScoresByEmail(storeId: string, filter: SQL): Promise<{ email: string; score: number }[]> {
  const deals = await typedRow(
    z.object({ on: col.bool }),
    sql`select (commerce.feature_on(${storeId}::uuid, 'sales') and commerce.extension_on(${storeId}::uuid, 'deals')) as on`,
  );
  const rows = await leadRows(storeId, filter, deals?.on ?? false);
  return rows.map((r) => ({ email: r.email, score: scoreOf(r).score }));
}
