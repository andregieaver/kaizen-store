import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { LIFT_DAYS, forecast, type Forecast } from "@/lib/demand-forecast";

import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The demand forecast's figures (`docs/100-day-challenge.md` C4, D636): each variant's paid units per day in the store's own days (bundles'
 * components included), from a year and the pace's days back to today; the days a price campaign reached its product, past and planned; and
 * the days its received purchase orders took. The arithmetic is `forecast()` in `src/lib/demand-forecast.ts`.
 */

/** The campaigns that lower a product's price, and so move how much of it sells. */
const PRICE_KINDS = ["percent", "multi_buy", "amount", "tiered", "bxgy"] as const;

const DAY = z.object({ variant_id: col.uuid, day: col.text, units: col.int });
const CAMPAIGN = z.object({ product_ids: z.unknown(), term_ids: z.unknown(), starts: col.text, ends: col.textOrNull });
const TERM = z.object({ product_id: col.uuid, term_id: col.uuid });
const LEAD = z.object({ variant_id: col.uuid, days: col.decimal });
const TODAY = z.object({ today: col.text });

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/** The ISO days from `from`, `n` of them. */
function days(from: string, n: number): string[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  return Array.from({ length: Math.max(0, n) }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}
const shift = (day: string, by: number) => days(day, 1 + Math.max(0, by))[Math.max(0, by)] ?? day;
const back = (day: string, by: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() - by * 86_400_000).toISOString().slice(0, 10);

export type ForecastVariant = { variantId: string; productId: string; onHand: number };

/** Each variant's forecast, by variant id, from the last `paceDays` days and for `coverDays` plus its delivery time ahead. */
export async function demandForecasts(
  store: Pick<Store, "id" | "timeZone">,
  variants: readonly ForecastVariant[],
  options: { paceDays: number; coverDays: number; leadDays: number },
): Promise<Map<string, Forecast>> {
  const out = new Map<string, Forecast>();
  if (variants.length === 0) return out;
  const today = (await typedRow(TODAY, sql`select (now() at time zone ${store.timeZone})::date::text as today`))?.today ?? new Date().toISOString().slice(0, 10);
  const horizon = options.coverDays + options.leadDays;
  const first = back(today, 365 + options.paceDays);
  const [sold, campaigns, terms, leads] = await Promise.all([
    typedRows(
      DAY,
      sql`
        with sold as (
          select l.variant_id, (o.placed_at at time zone ${store.timeZone})::date as d, l.quantity as q
          from commerce.order_lines l join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
          where l.store_id = ${store.id}::uuid and o.placed_at >= (${first}::date)::timestamp at time zone ${store.timeZone} and o.status <> 'cancelled'
            and o.copied_from is null and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')
          union all
          select c.variant_id, (o.placed_at at time zone ${store.timeZone})::date, c.quantity * l.quantity
          from commerce.order_line_components c
          join commerce.order_lines l on l.store_id = c.store_id and l.id = c.order_line_id
          join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
          where c.store_id = ${store.id}::uuid and o.placed_at >= (${first}::date)::timestamp at time zone ${store.timeZone} and o.status <> 'cancelled'
            and o.copied_from is null and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')
        )
        select variant_id, d::text as day, sum(q)::int as units from sold where variant_id is not null group by variant_id, d
      `,
    ),
    // A campaign's days: from its start (or when it was made) to its end, or until it was switched off; open-ended while it is on.
    typedRows(
      CAMPAIGN,
      sql`
        select product_ids, term_ids, (coalesce(starts_at, created_at) at time zone ${store.timeZone})::date::text as starts,
          (case when ends_at is not null then ends_at at time zone ${store.timeZone}
                when not active then updated_at at time zone ${store.timeZone} end)::date::text as ends
        from commerce.campaigns
        where store_id = ${store.id}::uuid and kind in (${sql.join(PRICE_KINDS.map((k) => sql`${k}`), sql`, `)})
      `,
    ),
    typedRows(TERM, sql`select product_id, term_id from commerce.product_terms where store_id = ${store.id}::uuid`),
    typedRows(
      LEAD,
      sql`
        select l.variant_id, extract(epoch from (po.received_at - po.ordered_at)) / 86400 as days
        from commerce.purchase_order_lines l join commerce.purchase_orders po on po.store_id = l.store_id and po.id = l.purchase_order_id
        where l.store_id = ${store.id}::uuid and po.status = 'received' and po.ordered_at is not null and po.received_at > now() - interval '365 days'
      `,
    ),
  ]);
  const unitsBy = new Map<string, Map<string, number>>();
  for (const r of sold) {
    const m = unitsBy.get(r.variant_id) ?? new Map<string, number>();
    m.set(r.day, r.units);
    unitsBy.set(r.variant_id, m);
  }
  const termsBy = new Map<string, Set<string>>();
  for (const t of terms) termsBy.set(t.product_id, (termsBy.get(t.product_id) ?? new Set()).add(t.term_id));
  const leadBy = new Map<string, number[]>();
  for (const l of leads) leadBy.set(l.variant_id, [...(leadBy.get(l.variant_id) ?? []), l.days]);
  const windows = campaigns.map((c) => ({ products: ids(c.product_ids), terms: ids(c.term_ids), starts: c.starts, ends: c.ends }));

  const paceDays = days(back(today, options.paceDays - 1), options.paceDays);
  const liftDays = days(back(today, LIFT_DAYS - 1), LIFT_DAYS);
  const lastYearBefore = paceDays.map((d) => back(d, 365));
  const lastYearAhead = days(shift(back(today, 365), 1), horizon);
  const ahead = days(shift(today, 1), horizon);

  for (const v of variants) {
    const units = unitsBy.get(v.variantId) ?? new Map<string, number>();
    const at = (d: string) => units.get(d) ?? 0;
    const productTerms = termsBy.get(v.productId) ?? new Set<string>();
    const reaching = windows.filter((w) => (w.products.length === 0 && w.terms.length === 0) || w.products.includes(v.productId) || w.terms.some((t) => productTerms.has(t)));
    const onCampaign = (d: string) => reaching.some((w) => w.starts <= d && (w.ends === null || d <= w.ends));
    out.set(
      v.variantId,
      forecast({
        daily: paceDays.map(at),
        lastYear: { before: lastYearBefore.map(at), ahead: lastYearAhead.map(at) },
        liftDaily: liftDays.map(at),
        liftOnCampaign: liftDays.map(onCampaign),
        plannedCampaignShare: ahead.length > 0 ? ahead.filter(onCampaign).length / ahead.length : 0,
        leadSamples: leadBy.get(v.variantId) ?? [],
        leadDaysAsked: options.leadDays,
        coverDays: options.coverDays,
        onHand: v.onHand,
      }),
    );
  }
  return out;
}
