import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { audit, type Membership } from "./auth";
import { plainRate } from "./ecb-rates";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * An owner's own euro rate for a currency on a day (D161, `docs/wave-1c-reports.md` 2.2 and 3.2): used instead of the ECB's for this store's
 * OSS and IOSS figures when the ECB's cannot be had (a day not yet stored, a currency it does not publish) or the owner's accountant
 * wants another. Owners only, because the figures of a return depend on it; a reason of at least 10 characters is required and is shown
 * wherever the rate is used; an override never changes a document. The row is an upsert and the audit log is its history.
 */

const MIN_DAY = "2021-07-01";
export const REASON_MIN = 10;
export const REASON_MAX = 300;

const input = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Choose a currency.").refine((c) => c !== "EUR", "The euro needs no rate."),
  day: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date as year-month-day.").refine((d) => d >= MIN_DAY, `A rate is for a day from ${MIN_DAY}.`),
  rate: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(",", "."))
    .refine((v) => /^\d{1,9}(\.\d{1,6})?$/.test(v) && Number(v) > 0, "The rate is a positive number with at most six decimals: units of the currency per 1 euro."),
  reason: z
    .string()
    .trim()
    .min(REASON_MIN, `Say why, in at least ${REASON_MIN} characters (it is shown wherever the rate is used).`)
    .max(REASON_MAX, `The reason is at most ${REASON_MAX} characters.`),
});

export type OverrideResult = { ok: true; currency: string; day: string; rate: string; previous: string | null } | { ok: false; problems: string[] };

const refuse = (...problems: string[]): { ok: false; problems: string[] } => ({ ok: false, problems });

const today = (): string => new Date().toISOString().slice(0, 10);

/** Sets the store's rate for a currency on a day. Owners only. Audit: `analytics.tax_rate_override_set` (currency, day, old and new rate, never the reason's words twice). */
export async function setRateOverride(membership: Membership, raw: unknown): Promise<OverrideResult> {
  if (!memberCan(membership, "owner")) return refuse("Only an owner can enter a rate for a return.");
  const parsed = input.safeParse(raw);
  if (!parsed.success) return refuse(...new Set(parsed.error.issues.map((issue) => issue.message)));
  const { currency, day, rate, reason } = parsed.data;
  if (day > today()) return refuse("A rate is entered for a day that has passed, not for one that has not come.");
  const storeId = membership.store.id;
  const [old] = await db().execute<Row>(sql`
    select rate::text as rate from commerce.tax_rate_overrides where store_id = ${storeId}::uuid and currency = ${currency} and rate_date = ${day}::date
  `);
  try {
    await db().execute(sql`
      insert into commerce.tax_rate_overrides (store_id, currency, rate_date, rate, reason, set_by)
      values (${storeId}::uuid, ${currency}, ${day}::date, ${rate}::numeric, ${reason}, ${membership.account.id}::uuid)
      on conflict (store_id, currency, rate_date) do update set rate = excluded.rate, reason = excluded.reason, set_by = excluded.set_by, set_at = now()
    `);
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}` : String(error);
    if (/tax_rate_override\.future/.test(text)) return refuse("A rate is entered for a day that has passed, not for one that has not come.");
    throw error;
  }
  const previous = old ? plainRate(String(old.rate)) : null;
  await audit(membership.account.id, storeId, "analytics.tax_rate_override_set", { currency, day, previous, rate: plainRate(rate) });
  return { ok: true, currency, day, rate: plainRate(rate), previous };
}

export type OverrideRow = { currency: string; day: string; rate: string; reason: string; setBy: string | null; setAt: string };

/** The store's own rates, newest day first (the settings of a return). Every query of them carries the store id. */
export async function listOverrides(storeId: string, limit = 100): Promise<OverrideRow[]> {
  const rows = await db().execute<Row>(sql`
    select o.currency::text as currency, o.rate_date::text as rate_date, o.rate::text as rate, o.reason, a.email as set_by, o.set_at
    from commerce.tax_rate_overrides o
    left join commerce.accounts a on a.id = o.set_by
    where o.store_id = ${storeId}::uuid
    order by o.rate_date desc, o.currency
    limit ${limit}
  `);
  return rows.map((r) => ({
    currency: String(r.currency).trim(),
    day: String(r.rate_date).slice(0, 10),
    rate: plainRate(String(r.rate)),
    reason: String(r.reason),
    setBy: r.set_by ? String(r.set_by) : null,
    setAt: new Date(String(r.set_at)).toISOString(),
  }));
}
