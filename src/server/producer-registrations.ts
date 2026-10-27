import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  checkRegistration,
  groupMissing,
  SCHEME_IDS,
  type MissingGroup,
  type Registration,
  type RegistrationInput,
  type RegistrationProblem,
  type SchemeId,
} from "@/lib/producer-registrations";

import { audit } from "./auth";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Producer responsibility (wave 7 unit H, D342, `docs/wave-7-storefront.md` section 4, H): the only writer of `commerce.producer_registrations`,
 * and the reads of the Producer responsibility page, the product page and the AI manager. Whether a product is sold in a market for want of a
 * registration is the database's rule (`commerce.registration_blocks()`, read through `commerce.missing_registrations` here and
 * `commerce.line_unregistered()` by the cart and `placeOrder()`); this module never decides it again. Every query takes the store's id.
 */

const scheme = z.enum(SCHEME_IDS);
const market = z.string().transform((v) => v.trim());
const dayCol = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const REGISTRATION_ROW = z.object({
  id: col.uuid,
  scheme,
  market_code: market,
  registration_number: col.textOrNull,
  authority: col.textOrNull,
  exemption: col.textOrNull,
  show_number: col.bool,
  valid_from: dayCol,
  valid_to: dayCol.nullable(),
});

const asRegistration = (r: z.output<typeof REGISTRATION_ROW>): Registration => ({
  id: r.id,
  scheme: r.scheme,
  market: r.market_code,
  kind: r.exemption === null ? "registered" : "exempt",
  number: r.registration_number,
  authority: r.authority,
  exemption: r.exemption,
  showNumber: r.show_number,
  validFrom: r.valid_from,
  validTo: r.valid_to,
});

/** The store's own day (its time zone), against which registrations are valid: the database's `today` in `registration_blocks()`. */
export async function storeToday(storeId: string, runner: Executor = db()): Promise<string> {
  const row = await typedRow(
    z.object({ today: dayCol }),
    sql`select to_char((now() at time zone s.time_zone)::date, 'YYYY-MM-DD') as today from commerce.stores s where s.id = ${storeId}::uuid`,
    runner,
  );
  return row?.today ?? new Date().toISOString().slice(0, 10);
}

/** The store's registrations and exemptions, by scheme, country and start (the latest first). */
export async function listRegistrations(storeId: string, runner: Executor = db()): Promise<Registration[]> {
  const rows = await typedRows(
    REGISTRATION_ROW,
    sql`
      select id, scheme, market_code, registration_number, authority, exemption, show_number,
        to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(valid_to, 'YYYY-MM-DD') as valid_to
      from commerce.producer_registrations
      where store_id = ${storeId}::uuid
      order by array_position(${sql.raw(`array[${SCHEME_IDS.map((s) => `'${s}'`).join(", ")}]::text[]`)}, scheme::text), market_code, valid_from desc, created_at
    `,
    runner,
  );
  return rows.map(asRegistration);
}

/**
 * What has no valid registration today, by scheme and country, with the products' titles in `locale` (else any): the store's active products
 * under a scheme with nothing valid in an active market, as `commerce.missing_registrations` lists them; a group is `blocked` (not sold there)
 * when the store has a registration on record for that scheme and country, else it is a registration never recorded (a warning).
 */
export async function missingRegistrations(storeId: string, locale: string, runner: Executor = db()): Promise<MissingGroup[]> {
  const rows = await typedRows(
    z.object({ product_id: col.uuid, handle: col.text, market_code: market, scheme, blocked: col.bool, title: col.text }),
    sql`
      select mr.product_id, mr.handle, mr.market_code, mr.scheme, mr.blocked,
        coalesce(
          (select t.title from commerce.product_translations t where t.product_id = mr.product_id and t.locale = ${locale}),
          (select t.title from commerce.product_translations t where t.product_id = mr.product_id order by t.locale limit 1),
          mr.handle
        ) as title
      from commerce.missing_registrations mr
      where mr.store_id = ${storeId}::uuid
    `,
    runner,
  );
  return groupMissing(rows.map((r) => ({ productId: r.product_id, handle: r.handle, title: r.title, market: r.market_code, scheme: r.scheme, blocked: r.blocked })));
}

/** The schemes that stop this product being sold in the market today (none: registrations do not stop it). Read per request. */
export async function blockedSchemes(storeId: string, productId: string, marketCode: string, runner: Executor = db()): Promise<SchemeId[]> {
  const rows = await typedRows(
    z.object({ scheme }),
    sql`select distinct b.scheme from commerce.registration_blocks(${storeId}::uuid, ${marketCode}, ${productId}::uuid) b order by b.scheme`,
    runner,
  );
  return rows.map((r) => r.scheme);
}

export type ShownRegistration = { scheme: SchemeId; number: string; authority: string };

/** The numbers the owner chose to show on the product pages of a market, for this product's schemes, valid today: one per scheme. */
export async function shownRegistrationNumbers(runner: Executor, storeId: string, productId: string, marketCode: string): Promise<ShownRegistration[]> {
  const rows = await typedRows(
    z.object({ scheme, registration_number: col.text, authority: col.text }),
    sql`
      select r.scheme, r.registration_number, r.authority
      from commerce.producer_registrations r
      join commerce.product_schemes ps on ps.store_id = r.store_id and ps.scheme = r.scheme and ps.product_id = ${productId}::uuid
      join commerce.stores s on s.id = r.store_id
      where r.store_id = ${storeId}::uuid and r.market_code = ${marketCode} and r.show_number and r.exemption is null
        and r.valid_from <= (now() at time zone s.time_zone)::date
        and (r.valid_to is null or r.valid_to >= (now() at time zone s.time_zone)::date)
      order by r.scheme, r.valid_from desc
    `,
    runner,
  );
  const seen = new Set<SchemeId>();
  return rows.flatMap((r) => {
    if (seen.has(r.scheme)) return [];
    seen.add(r.scheme);
    return [{ scheme: r.scheme, number: r.registration_number, authority: r.authority }];
  });
}

export type SaveResult = { ok: true; id: string } | { ok: false; problems: RegistrationProblem[] } | { ok: false; missing: true };

/**
 * Adds a registration or exemption (`id` null) or changes one of this store's, after `checkRegistration()` against the store's countries.
 * An id of another store's (or none at all) is `missing`, never written. Audited with what it is for and its days, never its number.
 */
export async function saveRegistration(
  store: { id: string; keptMarkets: readonly { code: string }[] },
  accountId: string | null,
  raw: Parameters<typeof checkRegistration>[0],
  id: string | null = null,
): Promise<SaveResult> {
  const checked = checkRegistration(raw, store.keptMarkets.map((m) => m.code));
  if (!checked.ok) return checked;
  const r: RegistrationInput = checked.value;
  const row = await typedRow(
    z.object({ id: col.uuid }),
    id
      ? sql`
          update commerce.producer_registrations set
            scheme = ${r.scheme}::commerce.producer_scheme, market_code = ${r.market}, registration_number = ${r.number},
            authority = ${r.authority}, exemption = ${r.exemption}, show_number = ${r.showNumber},
            valid_from = ${r.validFrom}::date, valid_to = ${r.validTo}::date, updated_at = now()
          where store_id = ${store.id}::uuid and id = ${id}::uuid
          returning id
        `
      : sql`
          insert into commerce.producer_registrations
            (store_id, market_code, scheme, registration_number, authority, exemption, show_number, valid_from, valid_to)
          values (${store.id}::uuid, ${r.market}, ${r.scheme}::commerce.producer_scheme, ${r.number}, ${r.authority}, ${r.exemption},
            ${r.showNumber}, ${r.validFrom}::date, ${r.validTo}::date)
          returning id
        `,
  );
  if (!row) return { ok: false, missing: true };
  await audit(
    accountId,
    store.id,
    "settings.producer_registration_saved",
    { scheme: r.scheme, market: r.market, kind: r.kind, validFrom: r.validFrom, validTo: r.validTo, added: id === null },
    { area: "settings", target: { type: "producer_registration", id: row.id } },
  );
  return { ok: true, id: row.id };
}

/** Takes one of this store's registrations away (entered by mistake); false when it is not the store's. Audited. */
export async function removeRegistration(storeId: string, accountId: string | null, id: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ scheme, market_code: market }),
    sql`delete from commerce.producer_registrations where store_id = ${storeId}::uuid and id = ${id}::uuid returning scheme, market_code`,
  );
  if (!row) return false;
  await audit(
    accountId,
    storeId,
    "settings.producer_registration_removed",
    { scheme: row.scheme, market: row.market_code },
    { area: "settings", target: { type: "producer_registration", id } },
  );
  return true;
}
