import "server-only";

import { revalidateTag, updateTag } from "next/cache";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  ANALYTICS_DEFAULTS,
  firstOfMonth,
  isValidDay,
  parseAnalyticsSettings,
  parseSpend,
  parsePeriodTarget,
  parseTarget,
  type AnalyticsSettings,
  type PeriodTarget,
} from "@/lib/analytics-settings";
import { parseCsv, recordsOf } from "@/lib/csv";
import { mainCurrency } from "@/lib/markets";

import { audit, type Membership } from "./auth";
import { cookiesTag } from "./site-cookies";
import { storeTag } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";
import { can } from "@/lib/permissions";

type Row = Record<string, unknown>;

/** The money reads here (CODE-02): amounts in minor units of the store's main currency, a target in its metric's unit. */
const SETTINGS_ROW = z.object({
  payment_fee_bps: col.int,
  payment_fee_fixed_minor: col.minor,
  shipping_cost_minor: col.minor,
  fixed_costs_monthly_minor: col.minor,
  ltv_lifespan_years: col.int,
  updated_at: col.timestamp,
});
const MONTH_TARGET_ROW = z.object({ month: col.text, revenue_target_minor: col.minor });
const PERIOD_TARGET_ROW = z.object({ id: col.text, metric: col.text, period: col.text, starts_on: col.text, ends_on: col.text, target_value: col.minor });
const SPEND_ROW = z.object({ id: col.text, day: col.text, channel: col.text, campaign: col.text, amount_minor: col.minor, note: col.textOrNull });

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
  const row = await typedRow(
    SETTINGS_ROW,
    sql`
    select payment_fee_bps, payment_fee_fixed_minor, shipping_cost_minor, fixed_costs_monthly_minor, ltv_lifespan_years, updated_at
    from commerce.analytics_settings where store_id = ${storeId}::uuid
  `,
  );
  if (!row) return { ...ANALYTICS_DEFAULTS, saved: false, updatedAt: null };
  return {
    paymentFeeBps: row.payment_fee_bps,
    paymentFeeFixedMinor: row.payment_fee_fixed_minor,
    shippingCostMinor: row.shipping_cost_minor,
    fixedCostsMonthlyMinor: row.fixed_costs_monthly_minor,
    ltvLifespanYears: row.ltv_lifespan_years,
    saved: true,
    updatedAt: row.updated_at,
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
  // The cookie page lists the first-visit cookie only while visits are counted (D303 I3).
  refreshTag(cookiesTag(store.id));
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

/** The store's monthly net-sales targets, newest month first (the first form, D152; every other target is `listPeriodTargets()`). */
export async function listTargets(storeId: string, limit = 24): Promise<StoredTarget[]> {
  const rows = await typedRows(
    MONTH_TARGET_ROW,
    sql`
    select month::text as month, revenue_target_minor from commerce.analytics_targets
    where store_id = ${storeId}::uuid and month is not null order by month desc limit ${Math.min(Math.max(Math.floor(limit), 1), 120)}
  `,
  );
  return rows.map((r) => ({ month: r.month, revenueTargetMinor: r.revenue_target_minor }));
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

/** A target of any metric and period (D348), in the metric's unit (`TARGET_METRICS`). */
export type StoredPeriodTarget = PeriodTarget & { id: string };

/** The store's targets of every kind whose period ends on or after `from` (every one without it), soonest first; at most `limit`. */
export async function listPeriodTargets(storeId: string, { from, limit = 100 }: { from?: string; limit?: number } = {}): Promise<StoredPeriodTarget[]> {
  const after = from && isValidDay(from) ? sql`and ends_on >= ${from}::date` : sql``;
  const rows = await typedRows(
    PERIOD_TARGET_ROW,
    sql`
    select id, metric, period, starts_on::text as starts_on, ends_on::text as ends_on, target_value from commerce.analytics_targets
    where store_id = ${storeId}::uuid ${after}
    order by starts_on, metric, period limit ${Math.min(Math.max(Math.floor(limit), 1), 500)}
  `,
  );
  return rows.map((r) => ({
    id: r.id,
    metric: r.metric as PeriodTarget["metric"],
    period: r.period as PeriodTarget["period"],
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    targetValue: r.target_value,
  }));
}

/**
 * Sets a target of any metric and period (`parsePeriodTarget()`: `{ metric, period, start, end?, value }`); a metric, period and first day has one, so
 * it replaces. Any member with the analytics' write key, as a month's target was (a target changes nothing a shopper sees).
 */
export async function savePeriodTarget({ account, store }: Pick<Membership, "account" | "store">, input: unknown): Promise<AnalyticsResult<{ target: StoredPeriodTarget; replaced: boolean }>> {
  const parsed = parsePeriodTarget(input, mainCurrency(store));
  if (!parsed.ok) return refuse(...parsed.problems);
  const t = parsed.value;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.analytics_targets (store_id, metric, period, starts_on, ends_on, target_value)
    values (${store.id}::uuid, ${t.metric}, ${t.period}, ${t.startsOn}::date, ${t.endsOn}::date, ${t.targetValue})
    on conflict (store_id, metric, period, starts_on) do update set ends_on = excluded.ends_on, target_value = excluded.target_value
    returning id, (xmax <> 0) as replaced
  `);
  await audit(account.id, store.id, "analytics.target", { ...t, currency: mainCurrency(store) });
  return { ok: true, target: { ...t, id: String(row.id) }, replaced: Boolean(row.replaced) };
}

/** Takes a target of any kind away by its id, if it is the store's own; false when there was none. */
export async function deletePeriodTarget({ account, store }: Pick<Membership, "account" | "store">, id: string): Promise<AnalyticsResult<{ deleted: boolean }>> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: true, deleted: false };
  const rows = await db().execute<Row>(sql`
    delete from commerce.analytics_targets where store_id = ${store.id}::uuid and id = ${id}::uuid
    returning metric, period, starts_on::text as starts_on
  `);
  if (rows.length > 0) await audit(account.id, store.id, "analytics.target_delete", { metric: String(rows[0].metric), period: String(rows[0].period), startsOn: String(rows[0].starts_on) });
  return { ok: true, deleted: rows.length > 0 };
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
  const rows = await typedRows(
    SPEND_ROW,
    sql`
    select id, day::text as day, channel, campaign, amount_minor, note from commerce.marketing_spend
    where store_id = ${storeId}::uuid ${since} ${until}
    order by day desc, channel, campaign
    limit ${Math.min(Math.max(Math.floor(limit), 1), 1000)}
  `,
  );
  return rows.map((r) => ({
    id: r.id,
    day: r.day,
    channel: r.channel,
    campaign: r.campaign,
    amountMinor: r.amount_minor,
    note: r.note,
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

/** How many rows one spend file may hold. */
export const SPEND_IMPORT_MAX = 2000;

export type SpendImport = { added: number; existing: number; refused: { line: number; problem: string }[] };

const pick = (record: Record<string, string>, names: readonly string[]): string => {
  for (const [key, value] of Object.entries(record)) if (names.includes(key.trim().toLowerCase())) return value.trim();
  return "";
};

/**
 * Ad spend from a CSV file (D303 I3): columns `day` (or `date`), `channel`, `campaign`, `amount` (or `spend`, `cost`) and an optional
 * `currency`, which must be the store's main one. A row already entered for its day, channel and campaign is left as it is (`existing`),
 * so the same file imported twice adds nothing; every refused row is named by its line. One audit entry with the counts.
 */
export async function importSpend({ account, store }: Membership, input: string | Uint8Array): Promise<AnalyticsResult<SpendImport>> {
  const currency = mainCurrency(store);
  const parsed = parseCsv(input);
  const { header, records } = recordsOf(parsed.rows);
  const names = header.map((h) => h.toLowerCase());
  if (!names.some((n) => n === "day" || n === "date") || !names.includes("channel") || !names.some((n) => ["amount", "spend", "cost"].includes(n))) {
    return refuse("The file needs the columns day, channel, campaign and amount.");
  }
  if (records.length === 0) return refuse("The file has no rows.");
  if (records.length > SPEND_IMPORT_MAX) return refuse(`A file may hold at most ${SPEND_IMPORT_MAX} rows.`);
  const refused: SpendImport["refused"] = [];
  const rows: { line: number; day: string; channel: string; campaign: string; amountMinor: number }[] = [];
  records.forEach((record, i) => {
    const line = i + 2;
    if (Object.values(record).every((v) => v.trim() === "")) return;
    const own = pick(record, ["currency"]).toUpperCase();
    if (own && own !== currency) return void refused.push({ line, problem: `Amounts must be in ${currency}.` });
    const spend = parseSpend(
      { day: pick(record, ["day", "date"]), channel: pick(record, ["channel"]).toLowerCase(), campaign: pick(record, ["campaign"]), amount: pick(record, ["amount", "spend", "cost"]) },
      currency,
    );
    if (!spend.ok) return void refused.push({ line, problem: spend.problems[0] ?? "Not a row of spend." });
    rows.push({ line, ...spend.value });
  });
  let added = 0;
  for (const r of rows) {
    const done = await db().execute<Row>(sql`
      insert into commerce.marketing_spend (store_id, day, channel, campaign, amount_minor)
      values (${store.id}::uuid, ${r.day}::date, ${r.channel}, ${r.campaign}, ${r.amountMinor})
      on conflict (store_id, day, channel, campaign) do nothing
      returning 1
    `);
    added += done.length;
  }
  const result = { added, existing: rows.length - added, refused };
  await audit(account.id, store.id, "analytics.spend_import", { added, existing: result.existing, refused: refused.length, currency });
  return { ok: true, ...result };
}
