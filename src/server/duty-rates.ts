import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { APPLIES_TO, dutyRowProblem, type DutyRow, type DutyRowInput } from "@/lib/duties";

import { audit, type Account } from "./auth";
import { asDutyRow, DUTY_RATE_COLUMNS, DUTY_RATE_ROW } from "./customs";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The platform's duty rates (wave 7 unit I, D343, decision 2 of `docs/wave-7-storefront.md`): the ONLY writer of `commerce.duty_rates`, for platform
 * admins at `/admin/platform/duty-rates`. Each function checks the account itself, as every platform action does; a store can change none of it.
 * A row is checked by `dutyRowProblem()` (the database checks the same) and every change is audited (`platform.duty_rate_saved`, `_verified`,
 * `_removed`, with the destination and heading, area platform). A change applies to carts and orders from then on: an order keeps the estimate it
 * was placed with (`orders.customs`).
 */

export type DutyAdminResult<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

const NOT_ADMIN = "Only a platform admin can change duty rates.";
const refuse = (...problems: string[]): { ok: false; problems: string[] } => ({ ok: false, problems });

export type DutyRateListed = DutyRow & { note: string; checkedOn: string; updatedAt: string };

const LISTED = z.object({ note: col.text, checked_on: z.string(), updated_at: col.timestamp });

/** Every row, by destination, heading and origin. */
export async function listDutyRates(): Promise<DutyRateListed[]> {
  const rows = await db().execute(sql`
    select ${DUTY_RATE_COLUMNS}, note, to_char(checked_on, 'YYYY-MM-DD') as checked_on, updated_at
    from commerce.duty_rates
    order by destination, hs_prefix, origin nulls first, applies_to, valid_from nulls first
  `);
  return rows.map((row) => {
    const extra = LISTED.parse(row);
    const base = asDutyRow(DUTY_RATE_ROW.parse(row));
    return { ...base, note: extra.note, checkedOn: extra.checked_on, updatedAt: extra.updated_at };
  });
}

// A field left out or empty is null: the default is the raw value, so it passes through the same steps as a typed one.
const day = z
  .string()
  .nullable()
  .default("")
  .transform((v) => (v === null || v.trim() === "" ? null : v.trim()))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are written YYYY-MM-DD.").nullable());
const upper = z.string().trim().toUpperCase();
const optionalUpper = z
  .string()
  .nullable()
  .default("")
  .transform((v) => (v === null || v.trim() === "" ? null : v.trim().toUpperCase()));
const optionalInt = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .pipe(z.number().int("Amounts and rates are whole numbers.").nullable());

/** A row as a form or a test gives it; amounts in minor units, rates in basis points. */
export const dutyRateInput = z.object({
  destination: upper,
  hsPrefix: z.string().trim().default(""),
  origin: optionalUpper,
  appliesTo: z.enum(APPLIES_TO).default("any"),
  dutyRateBps: optionalInt,
  perItemMinor: optionalInt,
  thresholdMinor: optionalInt,
  vatThresholdMinor: optionalInt,
  thresholdCurrency: optionalUpper,
  thresholdPer: z.enum(["consignment", "item"]).default("consignment"),
  importVatBps: optionalInt,
  shippingInValue: z.boolean().default(true),
  source: z.string().trim(),
  note: z.string().trim().default(""),
  checkedOn: z.string().trim(),
  verified: z.boolean().default(false),
  validFrom: day,
  validTo: day,
});

/** Adds a row, or changes the row `id`. Audited `platform.duty_rate_saved`. */
export async function saveDutyRate(account: Account, raw: unknown, id: string | null = null): Promise<DutyAdminResult<{ id: string }>> {
  if (!account.platformAdmin) return refuse(NOT_ADMIN);
  const parsed = dutyRateInput.safeParse(raw);
  if (!parsed.success) return refuse(...new Set(parsed.error.issues.map((issue) => issue.message)));
  const row: DutyRowInput = parsed.data;
  const problem = dutyRowProblem(row);
  if (problem) return refuse(problem);
  const values = sql`${row.destination}, ${row.hsPrefix}, ${row.origin}, ${row.appliesTo}, ${row.dutyRateBps}, ${row.perItemMinor}, ${row.thresholdMinor},
    ${row.vatThresholdMinor}, ${row.thresholdCurrency}, ${row.thresholdPer}, ${row.importVatBps}, ${row.shippingInValue}, ${row.source}, ${row.note},
    ${row.checkedOn}::date, ${row.verified}, ${row.validFrom}::date, ${row.validTo}::date, ${account.id}::uuid`;
  const saved = id
    ? await typedRow(
        z.object({ id: col.uuid }),
        sql`update commerce.duty_rates set (destination, hs_prefix, origin, applies_to, duty_rate_bps, per_item_minor, threshold_minor, vat_threshold_minor,
              threshold_currency, threshold_per, import_vat_bps, shipping_in_value, source, note, checked_on, verified, valid_from, valid_to, updated_by)
            = (${values}), updated_at = now()
            where id = ${id}::uuid returning id`,
      )
    : await typedRow(
        z.object({ id: col.uuid }),
        sql`insert into commerce.duty_rates (destination, hs_prefix, origin, applies_to, duty_rate_bps, per_item_minor, threshold_minor, vat_threshold_minor,
              threshold_currency, threshold_per, import_vat_bps, shipping_in_value, source, note, checked_on, verified, valid_from, valid_to, updated_by)
            values (${values}) returning id`,
      );
  if (!saved) return refuse("That row no longer exists.");
  await audit(account.id, null, "platform.duty_rate_saved", { id: saved.id, destination: row.destination, hsPrefix: row.hsPrefix, origin: row.origin, verified: row.verified, created: id === null }, { target: { type: "duty_rate", id: saved.id } });
  return { ok: true, id: saved.id };
}

/** Records that a person checked a row against its source (or takes that back). Audited `platform.duty_rate_verified`. */
export async function setDutyRateVerified(account: Account, id: string, verified: boolean): Promise<DutyAdminResult> {
  if (!account.platformAdmin) return refuse(NOT_ADMIN);
  const row = await typedRow(
    z.object({ destination: col.text, hs_prefix: col.text }),
    sql`update commerce.duty_rates set verified = ${verified}, checked_on = case when ${verified} then current_date else checked_on end, updated_at = now(), updated_by = ${account.id}::uuid
        where id = ${id}::uuid returning destination, hs_prefix`,
  );
  if (!row) return refuse("That row no longer exists.");
  await audit(account.id, null, "platform.duty_rate_verified", { id, destination: row.destination, hsPrefix: row.hs_prefix, verified }, { target: { type: "duty_rate", id } });
  return { ok: true };
}

/** Removes a row (one entered by mistake); orders keep the estimates they were placed with. Audited `platform.duty_rate_removed`. */
export async function removeDutyRate(account: Account, id: string): Promise<DutyAdminResult> {
  if (!account.platformAdmin) return refuse(NOT_ADMIN);
  const rows = await typedRows(
    z.object({ destination: col.text, hs_prefix: col.text }),
    sql`delete from commerce.duty_rates where id = ${id}::uuid returning destination, hs_prefix`,
  );
  if (rows.length === 0) return refuse("That row no longer exists.");
  await audit(account.id, null, "platform.duty_rate_removed", { id, destination: rows[0].destination, hsPrefix: rows[0].hs_prefix }, { target: { type: "duty_rate", id } });
  return { ok: true };
}
