import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PERSONAL_DATA } from "@/lib/personal-data";
import { PURPOSE_OF } from "@/lib/personal-purposes";
import { COPY_RULES } from "@/lib/store-copy-rules";

import { createTestDatabase } from "./testing";

/**
 * Changing the business behind a store (B8, D473): the rules the database holds, against real Postgres (PGlite) with every migration
 * applied. A change takes effect only on its day and only once the new business's numbers are known; it changes the store's legal name,
 * number, address and VAT registration (Work's too) and the series' prefixes in one go, keeping what was before and where each series
 * stood; one change is planned at a time; every issuer applies it first.
 */

let db: PGlite;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function store(slug: string): Promise<string> {
  const id = (await one<{ id: string }>(
    "insert into commerce.stores (slug, name, country, legal_name, organisation_number, postal_address) values ($1, $1, 'NO', 'Human Web Andre Gieaver', '915262341', 'Storgata 1, 0155 Oslo') returning id",
    [slug],
  )).id;
  await db.query("insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values ($1, true, 'NO915262341MVA') on conflict (store_id) do update set vat_registered = true, vat_number = 'NO915262341MVA'", [id]);
  await db.query("insert into commerce.work_settings (store_id, vat_registered, vat_number) values ($1, true, 'NO915262341MVA') on conflict (store_id) do update set vat_registered = true, vat_number = 'NO915262341MVA'", [id]);
  return id;
}
const today = async (storeId: string) => (await one<{ d: string }>("select commerce.store_day($1, now())::text as d", [storeId])).d;
const plan = (storeId: string, startsOn: string, over: Record<string, unknown> = {}) =>
  db.query<{ id: string }>(
    `insert into commerce.store_business_changes (store_id, starts_on, legal_name, business_form, organisation_number, vat_registered, vat_number, prefixes)
     values ($1, $2::date, 'Human Web AS', 'as', $3, $4, $5, $6::jsonb) returning id`,
    [storeId, startsOn, "organisation_number" in over ? over.organisation_number : "923609016", over.vat_registered ?? true, "vat_number" in over ? over.vat_number : "NO923609016MVA", JSON.stringify(over.prefixes ?? {})],
  );
const apply = async (storeId: string) => (await one<{ applied: boolean }>("select commerce.apply_business_change($1) as applied", [storeId])).applied;

beforeAll(async () => {
  db = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("a change of the business behind a store", () => {
  it("takes effect on its day, not before, and only once the new business's numbers are known", async () => {
    const s = await store("bc-day");
    const day = await today(s);
    await plan(s, `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`);
    expect(await apply(s)).toBe(false);
    await db.query("update commerce.store_business_changes set starts_on = $2::date, organisation_number = null where store_id = $1", [s, day]);
    expect(await apply(s)).toBe(false);
    await db.query("update commerce.store_business_changes set organisation_number = '923609016' where store_id = $1", [s]);
    expect(await apply(s)).toBe(true);
    expect(await apply(s)).toBe(false);
  });

  it("changes the store's business and Work's VAT number at once, keeping what was before and where each series stood", async () => {
    const s = await store("bc-apply");
    await plan(s, await today(s), { prefixes: { invoice: "AS-F-", work_invoice: "AS-W-" } });
    await db.query("update commerce.document_series set next_number = 43 where store_id = $1 and series = 'work_invoice'", [s]);
    expect(await apply(s)).toBe(true);
    expect(await one("select legal_name, organisation_number, postal_address from commerce.stores where id = $1", [s])).toEqual({
      legal_name: "Human Web AS",
      organisation_number: "923609016",
      postal_address: "Storgata 1, 0155 Oslo",
    });
    expect(await one("select vat_registered, vat_number from commerce.store_tax_profile where store_id = $1", [s])).toEqual({ vat_registered: true, vat_number: "NO923609016MVA" });
    expect(await one("select vat_number from commerce.work_settings where store_id = $1", [s])).toEqual({ vat_number: "NO923609016MVA" });
    const series = await db.query<{ series: string; prefix: string; next_number: number }>("select series, prefix, next_number from commerce.document_series where store_id = $1 order by series", [s]);
    expect(Object.fromEntries(series.rows.map((r) => [r.series, r.prefix]))).toMatchObject({ invoice: "AS-F-", credit_note: "K-", work_invoice: "AS-W-", work_credit_note: "WCN-" });
    const change = await one<{ status: string; before: Record<string, unknown>; series_start: Record<string, string> }>(
      "select status, before, series_start from commerce.store_business_changes where store_id = $1",
      [s],
    );
    expect(change.status).toBe("applied");
    expect(change.before).toMatchObject({ legalName: "Human Web Andre Gieaver", organisationNumber: "915262341", vatNumber: "NO915262341MVA", workVatNumber: "NO915262341MVA" });
    expect((change.before.prefixes as Record<string, string>).invoice).toBe("F-");
    expect(change.series_start).toEqual({ invoice: "AS-F-1", credit_note: "K-1", work_invoice: "AS-W-43", work_credit_note: "WCN-1" });
  });

  it("is planned one at a time, keeps its shape, and is never something but planned, applied or cancelled", async () => {
    const s = await store("bc-rules");
    const day = await today(s);
    await plan(s, day);
    await rejects("insert into commerce.store_business_changes (store_id, starts_on, legal_name, business_form) values ($1, $2::date, 'Second AS', 'as')", [s, day], /store_business_changes_planned_key/);
    await rejects("update commerce.store_business_changes set status = 'applied' where store_id = $1", [s], /store_business_changes_applied/);
    await rejects("update commerce.store_business_changes set business_form = 'llc' where store_id = $1", [s], /store_business_changes_form/);
    await rejects("update commerce.store_business_changes set vat_registered = false where store_id = $1", [s], /store_business_changes_vat/);
    await db.query("update commerce.store_business_changes set status = 'cancelled' where store_id = $1", [s]);
    await plan(s, day);
  });

  it("is applied by every issuer before it numbers anything, and the sales series' prefix changes only so", async () => {
    for (const fn of ["make_order_invoice", "make_credit_note", "make_edit_documents", "issue_work_invoice", "credit_work_invoice"]) {
      const def = await one<{ def: string }>(`select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'commerce' and p.proname = $1`, [fn]);
      expect(def.def, fn).toMatch(/\nBEGIN\n[^\n]*\n\s*PERFORM commerce\.apply_business_change\(p_store\);/);
    }
    const guard = await one<{ def: string }>("select pg_get_functiondef('commerce.sales_series_guard()'::regprocedure) as def");
    expect(guard.def).toContain("current_setting('commerce.business_change', true)");
  });

  it("is in the registers: the store's own, never copied with a store", () => {
    expect(PERSONAL_DATA.find((e) => e.table === "store_business_changes")).toMatchObject({ subject: "owner" });
    expect(PURPOSE_OF.store_business_changes).toBe("platform_service");
    expect(COPY_RULES.store_business_changes).toMatchObject({ group: "never" });
  });
});
