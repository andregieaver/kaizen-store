import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { ECB_CURRENCIES, ecbRateFor, nextPublicationDay, type EcbRate } from "@/lib/ecb-history";
import type { RateChoice, RateLookup } from "@/lib/oss-return";

import { audit, type Membership } from "./auth";
import { latestRates, ratesNearDay, type EcbFetch } from "./ecb-fetch";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * The euro rates the OSS and IOSS returns convert at (D161, `docs/wave-1c-reports.md` 4.5, 3.1). `commerce.ecb_reference_rates` holds the
 * ECB's reference rates, append-only (a stored rate is part of what a filed return rested on): the daily job inserts the days that are
 * absent and never replaces one, and a different figure for a stored day is only reported. An owner who needs a rate the ECB feed cannot
 * give asks for one day, or enters their own with a reason (`tax-rate-overrides.ts`); an override is for that store only. Nothing is ever
 * converted at today's rate: a return whose rate is not stored is incomplete.
 */

const MIN_DAY = "2021-07-01";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Postgres gives `7.475500`; the rate as the ECB published it has no trailing zeros. */
export function plainRate(rate: string): string {
  if (!rate.includes(".")) return rate;
  return rate.replace(/0+$/, "").replace(/\.$/, "");
}

const today = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// The daily job
// ---------------------------------------------------------------------------

export type StoreRatesResult = {
  /** The ECB answered. */
  ok: boolean;
  inserted: number;
  /** Stored days whose figure the ECB now gives differently: reported, never applied. */
  differing: number;
  days: number;
};

/**
 * Daily: stores the ECB's latest ninety days of rates once. Rows already stored are left as they are (a difference is logged as
 * `ecb.rate_differs`, never applied); a failure is logged and never throws, so the job's other work goes on.
 */
export async function storeEcbRates(deps: { fetch?: EcbFetch } = {}): Promise<StoreRatesResult> {
  try {
    const rates = await latestRates(deps.fetch);
    if (!rates || rates.length === 0) {
      console.warn("ecb.rates_unavailable");
      return { ok: false, inserted: 0, differing: 0, days: 0 };
    }
    const first = rates.reduce((min, r) => (r.date < min ? r.date : min), rates[0].date);
    const have = await db().execute<Row>(sql`
      select rate_date::text as rate_date, currency::text as currency, rate::text as rate from commerce.ecb_reference_rates where rate_date >= ${first}::date
    `);
    const stored = new Map(have.map((r) => [`${String(r.rate_date)}|${String(r.currency).trim()}`, Number(r.rate)]));
    const fresh: EcbRate[] = [];
    let differing = 0;
    for (const r of rates) {
      const known = stored.get(`${r.date}|${r.currency}`);
      if (known === undefined) fresh.push(r);
      else if (Math.abs(known - Number(r.rate)) > 1e-9) {
        differing += 1;
        console.warn("ecb.rate_differs", { date: r.date, currency: r.currency, stored: known, published: r.rate });
      }
    }
    let inserted = 0;
    for (let i = 0; i < fresh.length; i += 400) {
      const chunk = fresh.slice(i, i + 400);
      const values = sql.join(chunk.map((r) => sql`(${r.date}::date, ${r.currency}, ${r.rate}::numeric)`), sql`, `);
      const done = await db().execute<Row>(sql`
        insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ${values} on conflict (rate_date, currency) do nothing returning 1 as n
      `);
      inserted += done.length;
    }
    return { ok: true, inserted, differing, days: new Set(rates.map((r) => r.date)).size };
  } catch (error) {
    console.error("ecb.store_failed", error instanceof Error ? error.message : error);
    return { ok: false, inserted: 0, differing: 0, days: 0 };
  }
}

// ---------------------------------------------------------------------------
// One day, on request (the owner's)
// ---------------------------------------------------------------------------

export type FetchDayResult =
  | { ok: true; rate: string; date: string; already: boolean }
  | { ok: false; reason: "invalid" | "future" | "not_published" | "unavailable" | "limit"; message: string };

const MESSAGES = {
  invalid: "That is not a currency the ECB publishes a rate for, or not a day from 2021-07-01.",
  future: "That day has not come yet.",
  not_published: "The ECB has not published a rate for that day yet. It publishes about 16:00 Central European Time on working days.",
  unavailable: "The ECB could not be reached just now. Nothing was changed. Try again, or enter a rate yourself.",
  limit: "Too many rates have been asked of the ECB from this store in the last hour. Try again later, or enter a rate yourself.",
} as const;
const refuse = (reason: keyof typeof MESSAGES): FetchDayResult => ({ ok: false, reason, message: MESSAGES[reason] });

/** Requests to the ECB an owner's store may start in a clock hour, and all stores together: a stored rate or a refused request costs none. */
export const ECB_LIMIT_PER_STORE_PER_HOUR = 10;
export const ECB_LIMIT_ALL_STORES_PER_HOUR = 60;

/**
 * Reserves one request to the ECB for a store, atomically, with the counters VIES's limits use (`commerce.chat_usage`, one row per bucket
 * and clock hour, created or counted up in one statement so parallel requests each get their own number). The store's own bucket first,
 * then one for every store together (a null store), because an owner can have several stores and the ECB sees one shared address: a
 * scripted loop can neither burn function time on 8 MB downloads nor get that address throttled and break the daily job. A request over a
 * limit is counted and refused; nothing is asked of the ECB.
 */
export async function takeEcbSlot(storeId: string): Promise<boolean> {
  const take = async (store: string | null, bucket: string): Promise<number> => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${store}::uuid, ${bucket}, date_trunc('hour', now()), 1)
      on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
      returning count
    `);
    return Number(row?.count ?? 0);
  };
  if ((await take(storeId, "ecb:fetch")) > ECB_LIMIT_PER_STORE_PER_HOUR) return false;
  return (await take(null, "ecb:fetch")) <= ECB_LIMIT_ALL_STORES_PER_HOUR;
}

/** A code the ECB publishes, or one the daily job has already stored a rate for (a currency it added since this list was written). */
async function isPublishedCurrency(code: string): Promise<boolean> {
  if (ECB_CURRENCIES.has(code)) return true;
  const [row] = await db().execute<Row>(sql`select 1 as found from commerce.ecb_reference_rates where currency = ${code} limit 1`);
  return row !== undefined;
}

/**
 * Stores the one rate a return needs for `currency` on `day`: that day's, or the next day of publication's. Asks the ECB for that
 * currency and a week only, writes one row and never replaces one. Not a membership check: `fetchRateForOwner()` is the owner's way in.
 * `takeSlot` reserves a request before one is made (never for a stored rate, an invalid or a future request): false is `limit`.
 */
export async function fetchRatesForDay(currency: string, day: string, deps: { fetch?: EcbFetch; now?: Date; takeSlot?: () => Promise<boolean>; isPublished?: (code: string) => Promise<boolean> } = {}): Promise<FetchDayResult> {
  const code = String(currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || code === "EUR" || !DAY.test(day) || day < MIN_DAY) return refuse("invalid");
  const now = today(deps.now);
  if (day > now) return refuse("future");

  const stored = await storedRates([code], day, day);
  const have = ecbRateFor(stored, code, day);
  if (have) return { ok: true, rate: plainRate(have.rate), date: have.date, already: true };

  // Nothing is fetched for a code the ECB does not publish (it could only end in the full-history download), nor past the limit.
  if (!(await (deps.isPublished ?? isPublishedCurrency)(code))) return refuse("invalid");
  if (deps.takeSlot && !(await deps.takeSlot())) return refuse("limit");

  const found = await ratesNearDay(code, day, now, deps.fetch);
  if (!found) return refuse("unavailable");
  const chosen = ecbRateFor(found.rates, code, day);
  if (!chosen || chosen.date > now) return refuse("not_published");
  await db().execute(sql`
    insert into commerce.ecb_reference_rates (rate_date, currency, rate) values (${chosen.date}::date, ${code}, ${chosen.rate}::numeric)
    on conflict (rate_date, currency) do nothing
  `);
  return { ok: true, rate: plainRate(chosen.rate), date: chosen.date, already: false };
}

const fetchInput = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Choose a currency."),
  day: z.string().trim().regex(DAY, "Use a date as year-month-day."),
});

export type OwnerRateResult = FetchDayResult | { ok: false; reason: "forbidden" | "invalid"; message: string };

/** The owner asks the ECB for a return's rate. Owners only (the figures of a return depend on it). Audit: `analytics.tax_rate_fetched`. */
export async function fetchRateForOwner(membership: Membership, raw: unknown, deps: { fetch?: EcbFetch; now?: Date; takeSlot?: () => Promise<boolean>; isPublished?: (code: string) => Promise<boolean> } = {}): Promise<OwnerRateResult> {
  if (!memberCan(membership, "owner")) return { ok: false, reason: "forbidden", message: "Only an owner can fetch a rate for a return." };
  const parsed = fetchInput.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? MESSAGES.invalid };
  const result = await fetchRatesForDay(parsed.data.currency, parsed.data.day, { ...deps, takeSlot: deps.takeSlot ?? (() => takeEcbSlot(membership.store.id)) });
  if (result.ok && !result.already) {
    await audit(membership.account.id, membership.store.id, "analytics.tax_rate_fetched", { currency: parsed.data.currency, day: parsed.data.day, rateDate: result.date, rate: result.rate });
  }
  return result;
}

// ---------------------------------------------------------------------------
// What a return reads
// ---------------------------------------------------------------------------

/** The stored ECB rates of some currencies from `first` to a week after `last` (enough to reach any next day of publication). */
export async function storedRates(currencies: readonly string[], first: string, last: string): Promise<EcbRate[]> {
  if (currencies.length === 0) return [];
  const list = sql.join(currencies.map((c) => sql`${c}`), sql`, `);
  const rows = await db().execute<Row>(sql`
    select rate_date::text as rate_date, currency::text as currency, rate::text as rate
    from commerce.ecb_reference_rates
    where currency in (${list}) and rate_date >= ${first}::date and rate_date <= ${nextPublicationDay(last)}::date
    order by rate_date
  `);
  return rows.map((r) => ({ date: String(r.rate_date).slice(0, 10), currency: String(r.currency).trim(), rate: plainRate(String(r.rate)) }));
}

export type Override = { currency: string; day: string; rate: string; reason: string };

/** The store's own rates for some currencies on some days (an override applies to that exact day). */
export async function overridesFor(storeId: string, currencies: readonly string[], first: string, last: string): Promise<Override[]> {
  if (currencies.length === 0) return [];
  const list = sql.join(currencies.map((c) => sql`${c}`), sql`, `);
  const rows = await db().execute<Row>(sql`
    select currency::text as currency, rate_date::text as rate_date, rate::text as rate, reason
    from commerce.tax_rate_overrides
    where store_id = ${storeId}::uuid and currency in (${list}) and rate_date >= ${first}::date and rate_date <= ${last}::date
  `);
  return rows.map((r) => ({ currency: String(r.currency).trim(), day: String(r.rate_date).slice(0, 10), rate: plainRate(String(r.rate)), reason: String(r.reason) }));
}

export type RateRequest = { currency: string; day: string };

/**
 * The lookup `buildReturn()` asks for each currency and day: the owner's own rate for that store and day when there is one (labelled
 * with its reason), else the ECB's rate of the day or of the next day of publication, else null. Rates are read once for all the
 * requests; the euro itself is never asked for.
 */
export async function rateLookup(storeId: string, requests: readonly RateRequest[]): Promise<RateLookup> {
  const wanted = requests.filter((r) => r.currency !== "EUR");
  if (wanted.length === 0) return () => null;
  const currencies = [...new Set(wanted.map((r) => r.currency))].sort();
  const days = wanted.map((r) => r.day).sort();
  const first = days[0];
  const last = days[days.length - 1];
  const [stored, overrides] = await Promise.all([storedRates(currencies, first, last), overridesFor(storeId, currencies, first, last)]);
  const own = new Map(overrides.map((o) => [`${o.currency}|${o.day}`, o]));
  return (currency, day): RateChoice | null => {
    const mine = own.get(`${currency}|${day}`);
    if (mine) return { rate: mine.rate, date: mine.day, source: "owner", reason: mine.reason };
    const found = ecbRateFor(stored, currency, day);
    return found ? { rate: found.rate, date: found.date, source: "ecb", reason: null } : null;
  };
}
