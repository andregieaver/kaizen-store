import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { storeSiteUrl } from "@/lib/paths";
import type { PlatformApiRoute, RequestState } from "@/lib/platform-api";

import { platformSnapshot } from "./platform-briefing";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What Kaizena Flow's own API answers (C4 step 4, D517): the platform's stores (of owners: never a demo store, a template, a sandbox or its
 * own), each with its plan; its plans and their prices; the requests for a store; and the figures of the home (D513). Read only. Money is in
 * minor units with its currency, as the stores' Admin API gives it (D355); times are ISO 8601.
 */

const OWNERS_STORES = sql`not (s.is_template or s.starter) and not s.sandbox and not s.house`;

const storeRow = z.object({
  id: col.uuid,
  slug: col.text,
  name: col.text,
  country: col.textOrNull,
  status: col.text,
  created_at: col.timestamp,
  setup_completed_at: col.timestampOrNull,
  plan_name: col.textOrNull,
  interval: col.textOrNull,
  amount_minor: col.minorOrNull,
  currency: z.string().nullable(),
  billing_status: col.textOrNull,
  current_period_end: col.timestampOrNull,
  cancel_at_period_end: z.boolean().nullable(),
});

const STORE_SELECT = sql`
  select s.id, s.slug, s.name, s.country, s.status::text as status, s.created_at, s.setup_completed_at,
    p.name as plan_name, pp.interval, pp.amount_minor, pp.currency, b.status::text as billing_status, b.current_period_end, b.cancel_at_period_end
  from commerce.stores s
  left join commerce.store_billing b on b.store_id = s.id
  left join commerce.plans p on p.id = b.plan_id
  left join commerce.plan_prices pp on pp.id = b.price_id
`;

const storeOf = (r: z.output<typeof storeRow>) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  url: storeSiteUrl(r.slug),
  country: r.country,
  status: r.status,
  created_at: r.created_at,
  opened_at: r.setup_completed_at,
  plan: r.billing_status
    ? {
        name: r.plan_name,
        interval: r.interval,
        amount_minor: r.amount_minor,
        currency: r.currency?.trim() || null,
        status: r.billing_status,
        current_period_end: r.current_period_end,
        cancel_at_period_end: Boolean(r.cancel_at_period_end),
      }
    : null,
});

const page = (before: string | null, column: SQL) => (before ? sql`and ${column} < ${before}::timestamptz` : sql``);

/** The owners' stores, newest first; the next page is `before` the last one's `created_at`. */
async function listStores(limit: number, before: string | null) {
  const rows = await typedRows(storeRow, sql`${STORE_SELECT} where ${OWNERS_STORES} ${page(before, sql`s.created_at`)} order by s.created_at desc, s.id limit ${limit}`);
  return { data: rows.map(storeOf), has_more: rows.length === limit };
}

/** One store by its id or its address name; null for none (or not an owner's). */
async function getStore(idOrSlug: string) {
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const row = await typedRow(storeRow, sql`${STORE_SELECT} where ${OWNERS_STORES} and ${byId ? sql`s.id = ${idOrSlug}::uuid` : sql`s.slug = ${idOrSlug.toLowerCase()}`}`);
  return row ? storeOf(row) : null;
}

/** The plans, in their order, each with its prices. */
async function listPlans() {
  const plans = await typedRows(
    z.object({ id: col.uuid, name: col.text, active: col.bool, sale_fee_bps: col.int }),
    sql`select id, name, active, sale_fee_bps from commerce.plans order by position, name`,
  );
  const prices = await typedRows(
    z.object({ id: col.uuid, plan_id: col.uuid, currency: col.currency, interval: col.text, amount_minor: col.minor, active: col.bool }),
    sql`select id, plan_id, currency, interval, amount_minor, active from commerce.plan_prices order by currency, interval`,
  );
  return {
    data: plans.map((p) => ({
      id: p.id,
      name: p.name,
      active: p.active,
      sale_fee_bps: p.sale_fee_bps,
      prices: prices.filter((x) => x.plan_id === p.id).map((x) => ({ id: x.id, currency: x.currency, interval: x.interval, amount_minor: x.amount_minor, active: x.active })),
    })),
  };
}

/** Requests for a store, newest first: by state (`pending` when not given), the next page `before` the last one's `created_at`. */
async function listRequests(state: RequestState, limit: number, before: string | null) {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      store_name: col.text,
      name: col.text,
      email: col.text,
      domain: col.textOrNull,
      locale: col.textOrNull,
      status: col.text,
      self_serve: col.bool,
      store_id: col.uuid.nullable(),
      created_at: col.timestamp,
    }),
    sql`
      select id, store_name, name, email, domain, locale, status::text as status, self_serve, store_id, created_at from commerce.access_requests
      where ${state === "all" ? sql`true` : sql`status = ${state}::commerce.access_request_status`} ${page(before, sql`created_at`)}
      order by created_at desc, id limit ${limit}
    `,
  );
  return {
    data: rows.map((r) => ({
      id: r.id,
      store_name: r.store_name,
      name: r.name,
      email: r.email,
      domain: r.domain,
      language: r.locale ?? "en",
      status: r.status,
      self_serve: r.self_serve,
      store_id: r.store_id,
      created_at: r.created_at,
    })),
    has_more: rows.length === limit,
  };
}

/** The home's figures now (D513): recurring revenue and how it moved, paying and trying stores, sales this month, requests, targets. */
async function figures() {
  const s = await platformSnapshot();
  return {
    today: s.today,
    recurring_revenue: s.mrr.map((m) => ({ currency: m.currency, amount_minor: m.minor, month_moved_minor: m.monthMovedMinor, week_moved_minor: m.weekMovedMinor })),
    paying: s.paying,
    trialing: s.trialing,
    late: s.late,
    trials_ending: s.trialsEnding,
    sales: s.sales.map((x) => ({ currency: x.currency, month_minor: x.monthMinor, last_month_to_date_minor: x.lastMonthToDateMinor })),
    new_stores: s.newStores,
    sign_ups_today: s.signUpsToday,
    requests: { waiting: s.requests.waiting, oldest_hours: s.requests.oldestHours },
  };
}

export type PlatformApiAnswer = { status: number; body: unknown };

/** Answers a route; `params` are the request's query. A store not found is a 404. */
export async function runPlatformApiRoute(route: PlatformApiRoute, query: { limit: number; before: string | null; state: RequestState }): Promise<PlatformApiAnswer> {
  switch (route.name) {
    case "stores":
      return { status: 200, body: await listStores(query.limit, query.before) };
    case "store": {
      const store = await getStore(route.id);
      return store ? { status: 200, body: store } : { status: 404, body: { error: { code: "not_found", message: "No such store." } } };
    }
    case "plans":
      return { status: 200, body: await listPlans() };
    case "requests":
      return { status: 200, body: await listRequests(query.state, query.limit, query.before) };
    case "figures":
      return { status: 200, body: await figures() };
  }
}
