import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EXTENSION_IDS, EXTENSION_SOURCES } from "@/lib/extensions";
import { STORE_ONLY_EXTENSIONS } from "@/lib/workspace-admin";

import { createTestDatabase } from "./testing";

/**
 * The extension catalogue (D748 step E2, `docs/extensions.md` 8.3 and 12), against real Postgres (PGlite) with every migration applied: the
 * five extensions at the owner's list prices in euros and kroner, a month and a year, two bundles, and the rules the database holds (known
 * ids only, one price on offer per size, currency and interval, a plan's grant at one of the extension's own sizes, an account's row with a
 * known source and the dates that source needs).
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

const sizeOf = async (extension: string, position = 0) =>
  (await one<{ id: string }>("select id from commerce.extension_sizes where extension_id = $1 and position = $2", [extension, position])).id;

describe("the extension catalogue (D748 E2)", () => {
  it("has the five extensions in code's order, A/B testing only with a store and the other four also on their own", async () => {
    const found = await rows<{ id: string; standalone: boolean; store_only: boolean }>("select id, standalone, store_only from commerce.extensions order by position");
    expect(found.map((e) => e.id)).toEqual([...EXTENSION_IDS]);
    expect(found.filter((e) => e.standalone).map((e) => e.id)).toEqual(["support_desk", "email_automation", "work", "deals"]);
    expect(found.filter((e) => e.store_only).map((e) => e.id)).toEqual(["ab_testing"]);
    // A workspace (D748 E7) is never offered one: the code's list is the catalogue's.
    expect(found.filter((e) => e.store_only).map((e) => e.id)).toEqual([...STORE_ONLY_EXTENSIONS]);
  });

  it("prices every size at the list price in euros and kroner, a month and a year at ten months", async () => {
    const prices = await rows<{ extension_id: string; label: string; currency: string; interval: string; amount_minor: number }>(
      `select s.extension_id, s.label, p.currency, p.interval, p.amount_minor::int as amount_minor
         from commerce.extension_prices p join commerce.extension_sizes s on s.id = p.size_id
        where p.active order by s.extension_id, s.position, p.currency, p.interval`,
    );
    const eurMonth = prices.filter((p) => p.currency === "EUR" && p.interval === "month").map((p) => [p.extension_id, p.amount_minor]);
    expect(eurMonth).toEqual([
      ["ab_testing", 2900],
      ["deals", 3500],
      ["email_automation", 2500],
      ["email_automation", 5900],
      ["email_automation", 11900],
      ["email_automation", 19900],
      ["support_desk", 3900],
      ["work", 3500],
    ]);
    for (const p of prices.filter((p) => p.currency === "EUR" && p.interval === "month")) {
      const at = (currency: string, interval: string) =>
        prices.find((q) => q.extension_id === p.extension_id && q.label === p.label && q.currency === currency && q.interval === interval)?.amount_minor;
      expect(at("EUR", "year")).toBe(p.amount_minor * 10);
      expect(at("NOK", "month")).toBe(p.amount_minor * 10);
      expect(at("NOK", "year")).toBe(p.amount_minor * 100);
    }
    expect(await one("select allowances from commerce.extension_sizes where extension_id = 'email_automation' and position = 1")).toEqual({
      allowances: { contacts: 10000, emails_per_contact: 10 },
    });
  });

  it("has the Customers and Everything bundles at their prices", async () => {
    const bundles = await rows<{ name: string; members: string[]; eur: number }>(
      `select b.name, array_agg(m.extension_id order by m.extension_id) as members,
              (select p.amount_minor::int from commerce.extension_bundle_prices p where p.bundle_id = b.id and p.active and p.currency = 'EUR' and p.interval = 'month') as eur
         from commerce.extension_bundles b join commerce.extension_bundle_members m on m.bundle_id = b.id
        group by b.id order by b.position`,
    );
    expect(bundles).toEqual([
      { name: "Customers", members: ["deals", "email_automation", "support_desk"], eur: 8500 },
      { name: "Everything", members: ["ab_testing", "deals", "email_automation", "support_desk", "work"], eur: 11900 },
    ]);
  });

  it("refuses an unknown extension, a store-only one sold on its own, and a second price on offer", async () => {
    await expect(db.query("insert into commerce.extensions (id, name) values ('seo', 'SEO')")).rejects.toThrow(/extensions_known/);
    await expect(db.query("update commerce.extensions set standalone = true where id = 'ab_testing'")).rejects.toThrow(/extensions_standalone_needs_no_store/);
    await expect(
      db.query("insert into commerce.extension_prices (size_id, currency, interval, amount_minor) values ($1, 'EUR', 'month', 1000)", [await sizeOf("work")]),
    ).rejects.toThrow(/extension_prices_one_active/);
  });

  it("lets a plan include an extension only at one of that extension's own sizes", async () => {
    const plan = (await one<{ id: string }>("insert into commerce.plans (name) values ('Ext Plan') returning id")).id;
    await db.query("insert into commerce.plan_extension_grants (plan_id, extension_id, size_id) values ($1, 'email_automation', $2)", [plan, await sizeOf("email_automation", 1)]);
    await expect(
      db.query("insert into commerce.plan_extension_grants (plan_id, extension_id, size_id) values ($1, 'work', $2)", [plan, await sizeOf("deals")]),
    ).rejects.toThrow(/plan_extension_grants_size_fk/);
  });

  it("keeps an account's own row only with a known source and the dates it needs", async () => {
    expect([...EXTENSION_SOURCES]).toEqual(["bought", "bundle", "trial"]);
    const org = (await one<{ id: string }>("insert into commerce.organisations (name) values ('Ext AS') returning id")).id;
    await expect(db.query("insert into commerce.organisation_extensions (organisation_id, extension_id, source) values ($1, 'work', 'gift')", [org])).rejects.toThrow(
      /organisation_extensions_source/,
    );
    await expect(db.query("insert into commerce.organisation_extensions (organisation_id, extension_id, source) values ($1, 'work', 'trial')", [org])).rejects.toThrow(
      /organisation_extensions_trial/,
    );
    await expect(db.query("insert into commerce.organisation_extensions (organisation_id, extension_id, source) values ($1, 'work', 'bundle')", [org])).rejects.toThrow(
      /organisation_extensions_bundle/,
    );
    await db.query("insert into commerce.organisation_extensions (organisation_id, extension_id, source, trial_ends_at) values ($1, 'work', 'trial', now() + interval '14 days')", [org]);
    expect(await one("select count(*)::int as n from commerce.organisation_extensions where organisation_id = $1", [org])).toEqual({ n: 1 });
  });

  it("is not launched yet: every account has every extension until step E5", async () => {
    expect(await one("select extensions_launched_at from commerce.platform_settings")).toEqual({ extensions_launched_at: null });
  });
});
