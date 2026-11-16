import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { addDays, todayIn } from "@/lib/analytics-period";
import type { TrafficFacts } from "@/lib/experiment-traffic";

import { funnelCounts } from "./analytics-traffic-data";
import type { TestableTarget } from "./experiment-admin";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What a test of each target would have to work with (D148 phase 13, D658): the visits of the last 30 days (D152) that began on the
 * target's page (a page, the front page, the All products page), or every visit (the header and footer are on every page), or the visits that
 * viewed a product (a product layout), or reached the cart or checkout (a working page's part); the share of cookie choices that accepted
 * statistics, since only they take part; and the store's own funnel rates, the goals' rates today. A page's visits are those that began on it,
 * so the figure is at least what the page sees: the estimate errs long, never short. Nothing is counted while the store does not count visits.
 */
export async function experimentTraffic(store: Store, targets: readonly TestableTarget[], now = new Date()): Promise<TrafficFacts> {
  const consent = await typedRow(
    z.object({ total: col.int, yes: col.int }),
    sql`
      select count(*)::int as total, count(*) filter (where choices ->> 'statistics' = 'true')::int as yes
      from commerce.consents where store_id = ${store.id}::uuid and created_at > now() - interval '90 days'
    `,
  );
  const consentShare = consent && consent.total >= 20 ? consent.yes / consent.total : null;
  const none: TrafficFacts = {
    counting: false,
    days: 0,
    consentShare,
    baselines: { orders: null, cart: null, checkout: null },
    targets: Object.fromEntries(targets.map((t) => [t.id, { visitsPerDay: null, basis: null }])),
  };
  if (!store.visitCounting) return none;

  const today = todayIn(now, store.timeZone);
  const range = { from: addDays(today, -30), to: today };
  const [totals, slugs, funnel] = await Promise.all([
    typedRow(
      z.object({ days: col.int, visits: col.int, front: col.int, products: col.int, product_viewers: col.int, checkout: col.int }),
      sql`
        select count(distinct v.day)::int as days, count(*)::int as visits,
          count(*) filter (where v.landing_path = '/' or v.landing_path ~ '^/[a-z]{2}$')::int as front,
          count(*) filter (where v.landing_path ~ '^/[a-z]{2}/products$')::int as products,
          count(*) filter (where v.product_views > 0)::int as product_viewers,
          count(*) filter (where v.checkout_at is not null)::int as checkout
        from commerce.visits v
        where v.store_id = ${store.id}::uuid and v.day >= ${range.from}::date and v.day < ${range.to}::date
      `,
    ),
    typedRows(
      z.object({ slug: col.text, n: col.int }),
      sql`
        select substring(v.landing_path from '^/[a-z]{2}/([a-z0-9-]+)$') as slug, count(*)::int as n
        from commerce.visits v
        where v.store_id = ${store.id}::uuid and v.day >= ${range.from}::date and v.day < ${range.to}::date
          and v.landing_path ~ '^/[a-z]{2}/[a-z0-9-]+$'
        group by 1
      `,
    ),
    funnelCounts(store, range),
  ]);
  if (!totals || totals.visits === 0) return { ...none, counting: true };

  const days = Math.max(1, totals.days);
  const perDay = (n: number) => n / days;
  const bySlug = new Map(slugs.map((s) => [s.slug, s.n]));
  const n = (v: number | null | undefined) => v ?? 0;
  const sessions = n(funnel.sessions) > 0 ? n(funnel.sessions) : totals.visits;
  const rate = (count: number) => (sessions > 0 && count > 0 ? count / sessions : null);
  const of = (t: TestableTarget): TrafficFacts["targets"][string] => {
    if (t.kind === "header" || t.kind === "footer") return { visitsPerDay: perDay(totals.visits), basis: "site" };
    if (t.kind === "layout") return { visitsPerDay: perDay(totals.product_viewers), basis: "product_viewers" };
    if (t.kind === "role") {
      if (t.role === "front") return { visitsPerDay: perDay(totals.front), basis: "landing" };
      if (t.role === "products") return { visitsPerDay: perDay(totals.products), basis: "products" };
      if (t.role === "cart") return { visitsPerDay: perDay(n(funnel.carts)), basis: "cart" };
      if (t.role === "checkout") return { visitsPerDay: perDay(n(funnel.checkouts)), basis: "checkout" };
      return { visitsPerDay: null, basis: null };
    }
    return { visitsPerDay: perDay(bySlug.get(t.slug) ?? 0), basis: "landing" };
  };
  return {
    counting: true,
    days: totals.days,
    consentShare,
    baselines: { orders: rate(n(funnel.purchases)), cart: rate(n(funnel.carts)), checkout: rate(n(funnel.checkouts)) },
    targets: Object.fromEntries(targets.map((t) => [t.id, of(t)])),
  };
}
