import "server-only";

import { revalidateTag, updateTag } from "next/cache";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  ANALYTICS_DEFAULTS,
  firstOfMonth,
  isValidDay,
  parseAnalyticsSettings,
  parseSpend,
  parseTarget,
  type AnalyticsSettings,
} from "@/lib/analytics-settings";
import { mainCurrency } from "@/lib/markets";

import { audit, type Membership } from "./auth";
import { storeTag } from "./stores";
import { can } from "@/lib/permissions";

type Row = Record<string, unknown>;

/**
 * The store's analytics set-up (D152, `docs/analytics.md`): cost assumptions, monthly targets, marketing spend, the switch
 * for visit counting and the back-fill of costs onto earlier sales. Money here is in the store's main currency, typed like a
 * price. Who may do what: the cost assumptions, visit counting and the back-fill are the owner's (they decide what the
 * profit figures mean and what is counted about visitors); targets and spend are any member's, like the rest of the daily
 * work. Every change is written to the audit log with the store.
 */

export type AnalyticsResult<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

const OWNER_ONLY = "Only an owner can change this.";
const refuse = (...problems: string[]): { ok: false; problems: string[] } => ({ ok: false, problems });

/**
 * Refreshes a cache tag after a change: a server action may `updateTag` (the owner sees it at once); anywhere else (the AI
 * manager's route) that throws, and the tag is revalidated instead.
 */
function refreshTag(tag: string): void {
  try {
    updateTag(tag);
  } catch {
    revalidateTag(tag, "max");
  }
}

// ---------------------------------------------------------------------------
// Cost assumptions
// ---------------------------------------------------------------------------

export type StoredAnalyticsSettings = AnalyticsSettings & {
  /** The owner has saved the settings at least once; before that the figures are the defaults. */
  saved: boolean;
  updatedAt: string | null;
};

/** The store's cost assumptions, or the defaults (everything zero, lifespan 3 years) when none were saved. */
export async function getAnalyticsSettings(storeId: string): Promise<StoredAnalyticsSettings> {
  const [row] = await db().execute<Row>(sql`
    select payment_fee_bps, payment_fee_fixed_minor, shipping_cost_minor, fixed_costs_monthly_minor, ltv_lifespan_years, updated_at
    from commerce.analytics_settings where store_id = ${storeId}::uuid
  `);
  if (!row) return { ...ANALYTICS_DEFAULTS, saved: false, updatedAt: null };
  return {
    paymentFeeBps: Number(row.payment_fee_bps),
    paymentFeeFixedMinor: Number(row.payment_fee_fixed_minor),
    shippingCostMinor: Number(row.shipping_cost_minor),
    fixedCostsMonthlyMinor: Number(row.fixed_costs_monthly_minor),
    ltvLifespanYears: Number(row.ltv_lifespan_years),
    saved: true,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

/** Saves the cost assumptions as typed (`analyticsSettingsInput`), in the store's main currency. Owner only. */
export async function saveAnalyticsSettings(
  { account, store, role }: Membership,
  input: unknown,
): Promise<AnalyticsResult<{ settings: AnalyticsSettings }>> {
  if (!can({ role }, "owner")) return refuse(OWNER_ONLY);
  const parsed = parseAnalyticsSettings(input, mainCurrency(store));
  if (!parsed.ok) return refuse(...parsed.problems);
  const s = parsed.value;
  await db().execute(sql`
    insert into commerce.analytics_settings
      (store_id, payment_fee_bps, payment_fee_fixed_minor, shipping_cost_minor, fixed_costs_monthly_minor, ltv_lifespan_years)
    values (${store.id}::uuid, ${s.paymentFeeBps}, ${s.paymentFeeFixedMinor}, ${s.shippingCostMinor}, ${s.fixedCostsMonthlyMinor}, ${s.ltvLifespanYears})
    on conflict (store_id) do update set
      payment_fee_bps = excluded.payment_fee_bps, payment_fee_fixed_minor = excluded.payment_fee_fixed_minor,
      shipping_cost_minor = excluded.shipping_cost_minor, fixed_costs_monthly_minor = excluded.fixed_costs_monthly_minor,
      ltv_lifespan_years = excluded.ltv_lifespan_years, updated_at = now()
  `);
  await audit(account.id, store.id, "analytics.settings", { ...s, currency: mainCurrency(store) });
  refreshTag(storeTag(store.slug));
  return { ok: true, settings: s };
}

// ---------------------------------------------------------------------------
// Visit counting and costs on earlier sales
// ---------------------------------------------------------------------------

/**
 * Switches cookieless visit counting on or off (`stores.visit_counting`, off until chosen). Owner only. Switching it off
 * stops the counting and keeps what was counted (the daily job deletes rows after 25 months).
 */
export async function setVisitCounting({ account, store, role }: Membership, enabled: boolean): Promise<AnalyticsResult<{ enabled: boolean }>> {
  if (!can({ role }, "owner")) return refuse(OWNER_ONLY);
  await db().execute(sql`update commerce.stores set visit_counting = ${enabled} where id = ${store.id}::uuid`);
  await audit(account.id, store.id, "analytics.visit_counting", { enabled });
  refreshTag(storeTag(store.slug));
  return { ok: true, enabled };
}

/**
 * Gives earlier sales the cost the variant has now, for the order lines that sold without one: costs entered later apply
 * to the past, once, and a line that already has a cost is never changed. Copied orders (D129) are history and skipped,
 * and so is a variant with no cost. Owner only; returns how many lines were filled in.
 */
export async function backfillCosts({ account, store, role }: Membership): Promise<AnalyticsResult<{ lines: number }>> {
  if (!can({ role }, "owner")) return refuse(OWNER_ONLY);
  const rows = await db().execute<Row>(sql`
    update commerce.order_lines ol set unit_cost_minor = v.cost_minor
    from commerce.product_variants v, commerce.orders o
    where ol.store_id = ${store.id}::uuid and ol.unit_cost_minor is null
      and v.store_id = ol.store_id and v.id = ol.variant_id and v.cost_minor is not null
      and o.store_id = ol.store_id and o.id = ol.order_id and o.copied_from is null
    returning ol.id
  `);
  await audit(account.id, store.id, "analytics.costs_backfill", { lines: rows.length });
  return { ok: true, lines: rows.length };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type StoredTarget = { month: string; revenueTargetMinor: number };

/** The store's monthly targets, newest month first. */
export async function listTargets(storeId: string, limit = 24): Promise<StoredTarget[]> {
  const rows = await db().execute<Row>(sql`
    select month::text as month, revenue_target_minor from commerce.analytics_targets
    where store_id = ${storeId}::uuid order by month desc limit ${Math.min(Math.max(Math.floor(limit), 1), 120)}
  `);
  return rows.map((r) => ({ month: String(r.month), revenueTargetMinor: Number(r.revenue_target_minor) }));
}

/** Sets a month's net revenue target (typed `{ month: "2026-10", revenueTarget: "500 000" }`); a month has one, so it replaces. */
export async function saveTarget({ account, store }: Membership, input: unknown): Promise<AnalyticsResult<{ target: StoredTarget }>> {
  const parsed = parseTarget(input, mainCurrency(store));
  if (!parsed.ok) return refuse(...parsed.problems);
  const t = parsed.value;
  await db().execute(sql`
    insert into commerce.analytics_targets (store_id, month, revenue_target_minor)
    values (${store.id}::uuid, ${t.month}::date, ${t.revenueTargetMinor})
    on conflict (store_id, month) do update set revenue_target_minor = excluded.revenue_target_minor
  `);
  await audit(account.id, store.id, "analytics.target", { month: t.month, revenueTargetMinor: t.revenueTargetMinor, currency: mainCurrency(store) });
  return { ok: true, target: t };
}

/** Takes a month's target away (`month` as `YYYY-MM` or any day of it); true when there was one. */
export async function deleteTarget({ account, store }: Membership, month: string): Promise<AnalyticsResult<{ deleted: boolean }>> {
  const first = firstOfMonth(month);
  if (!first) return refuse("Choose a month.");
  const rows = await db().execute<Row>(sql`
    delete from commerce.analytics_targets where store_id = ${store.id}::uuid and month = ${first}::date returning month
  `);
  if (rows.length > 0) await audit(account.id, store.id, "analytics.target_delete", { month: first });
  return { ok: true, deleted: rows.length > 0 };
}

// ---------------------------------------------------------------------------
// Marketing spend
// ---------------------------------------------------------------------------

export type StoredSpend = {
  id: string;
  day: string;
  channel: string;
  campaign: string;
  amountMinor: number;
  note: string | null;
};

/**
 * What was entered as marketing spend, newest day first: from `from` up to but not including `to` (days as `YYYY-MM-DD`),
 * at most `limit` rows (default 200, at most 1000).
 */
export async function listSpend(
  storeId: string,
  { from, to, limit = 200 }: { from?: string; to?: string; limit?: number } = {},
): Promise<StoredSpend[]> {
  const since = from && isValidDay(from) ? sql`and day >= ${from}::date` : sql``;
  const until = to && isValidDay(to) ? sql`and day < ${to}::date` : sql``;
  const rows = await db().execute<Row>(sql`
    select id, day::text as day, channel, campaign, amount_minor, note from commerce.marketing_spend
    where store_id = ${storeId}::uuid ${since} ${until}
    order by day desc, channel, campaign
    limit ${Math.min(Math.max(Math.floor(limit), 1), 1000)}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    day: String(r.day),
    channel: String(r.channel),
    campaign: String(r.campaign),
    amountMinor: Number(r.amount_minor),
    note: r.note === null ? null : String(r.note),
  }));
}

/**
 * Enters what was spent on a channel (and a campaign in it) on a day, typed `{ day, channel, campaign?, amount, note? }` in
 * the main currency. A day, channel and campaign has one amount: entering it again replaces it (`replaced`).
 */
export async function addSpend({ account, store }: Membership, input: unknown): Promise<AnalyticsResult<{ id: string; replaced: boolean }>> {
  const parsed = parseSpend(input, mainCurrency(store));
  if (!parsed.ok) return refuse(...parsed.problems);
  const s = parsed.value;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.marketing_spend (store_id, day, channel, campaign, amount_minor, note)
    values (${store.id}::uuid, ${s.day}::date, ${s.channel}, ${s.campaign}, ${s.amountMinor}, ${s.note})
    on conflict (store_id, day, channel, campaign) do update set amount_minor = excluded.amount_minor, note = excluded.note
    returning id, (xmax <> 0) as replaced
  `);
  const replaced = Boolean(row.replaced);
  await audit(account.id, store.id, "analytics.spend", { ...s, currency: mainCurrency(store), replaced });
  return { ok: true, id: String(row.id), replaced };
}

/** Takes an entry of spend away, if it is the store's own; false when there was none. */
export async function deleteSpend({ account, store }: Membership, id: string): Promise<AnalyticsResult<{ deleted: boolean }>> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: true, deleted: false };
  const rows = await db().execute<Row>(sql`
    delete from commerce.marketing_spend where store_id = ${store.id}::uuid and id = ${id}::uuid
    returning day::text as day, channel, campaign, amount_minor
  `);
  if (rows.length > 0) {
    const r = rows[0];
    await audit(account.id, store.id, "analytics.spend_delete", {
      day: String(r.day),
      channel: String(r.channel),
      campaign: String(r.campaign),
      amountMinor: Number(r.amount_minor),
    });
  }
  return { ok: true, deleted: rows.length > 0 };
}
