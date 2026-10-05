import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ANALYTICS_TABLES, ANALYTICS_TABLE_IDS, lastDayOf, tableHeader } from "@/lib/analytics-export";
import { parseCsv } from "@/lib/csv";

import type { Account, Membership } from "./auth";
import type { Store } from "./stores";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fixture = await import("./analytics-insights-fixture");
const { addMember, auditRows, makeAccount } = await import("./trust-fixtures");
const { analyticsContextFor } = await import("./analytics-context");
const { buildTable, exportAnalyticsTable, mayExportTable } = await import("./analytics-export");
const { parseProductsSort, sortProducts } = await import("@/components/admin/analytics/products-view");
const { productsReport } = await import("./analytics-products-data");
const { overviewHead } = await import("./analytics-totals");
const { trafficReport } = await import("./analytics-traffic-data");
const { saveTarget, addSpend } = await import("./analytics-settings");

type Row = Record<string, unknown>;

/**
 * A CSV for every analytics table (D165, `docs/wave-2-data.md` 6.4), against the busy and the quiet store of `analytics-insights-fixture.ts`:
 * every registered table is built on a store with data and on one with none; the rows are the loaders' rows (the page's own figures, the
 * previous-period columns, a custom range, the page's sort); a currency with no rate is left out and counted, in the file's label and in the log;
 * a text that starts with a formula character is escaped; and a member without `analytics:write`, or without the owner role where the table lists
 * people, gets no file. Another store's rows never appear.
 */

let busy: Store;
let quiet: Store;
let owner: Membership;
let ownerOfQuiet: Membership;

const accountOf = async (store: Store): Promise<Account> => {
  const [row] = await db().execute<Row>(sql`select a.id, a.email, a.name from commerce.accounts a where a.email = ${`${store.slug}@example.com`}`);
  return { id: String(row.id), email: String(row.email), name: String(row.name), platformAdmin: false };
};
const member = (store: Store, account: Account, role: "owner" | "admin" = "owner", permissions: readonly string[] | null = null): Membership => ({ account, store, role, permissions });

const ctxOf = (m: Membership, query: Record<string, string> = {}) => analyticsContextFor(m, { period: "7d", compare: "previous", ...query }, fixture.NOW);
const csvOf = async (m: Membership, id: string, query: Record<string, string> = {}, dialect: "standard" | "excel_nordic" = "standard") => {
  const result = await exportAnalyticsTable(m, id, { period: "7d", compare: "previous", ...query }, dialect);
  if (!result.ok) throw new Error(`${id}: ${result.message}`);
  const parsed = parseCsv(result.csv);
  return { ...result, header: parsed.rows[0], body: parsed.rows.slice(1), parsed };
};

beforeAll(async () => {
  busy = await fixture.makeStore("export-busy", true);
  quiet = await fixture.makeStore("export-quiet", false);
  await fixture.seedBusyStore(busy);
  owner = member(busy, await accountOf(busy));
  ownerOfQuiet = member(quiet, await accountOf(quiet));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixture.NOW);
});

afterAll(async () => {
  vi.useRealTimers();
  await closeDb();
});

describe("every registered table", () => {
  it("is built on a store with data and on a store with none, with the registry's header and no totals row", async () => {
    for (const store of [busy, quiet]) {
      const m = store === busy ? owner : ownerOfQuiet;
      const ctx = await ctxOf(m);
      for (const id of ANALYTICS_TABLE_IDS) {
        const built = await buildTable(ctx, id, { period: "7d", compare: "previous" });
        expect(built, id).not.toBeNull();
        const table = ANALYTICS_TABLES[id];
        const file = await csvOf(m, id);
        expect(file.header, id).toEqual(tableHeader(table, !!built!.data.previous));
        // Every row has as many cells as the header, and a table with nothing to say has no rows, not a row of zeros.
        for (const row of file.body.filter((r) => r.length > 1 || r[0] !== "")) expect(row.length, id).toBe(file.header.length);
        // A store with no orders has no rows of products, customers, codes or channels: nothing is made up to fill a table.
        if (store === quiet && ["products.table", "customers.top", "marketing.discount_codes", "overview.top_revenue", "traffic.landing", "traffic.cities", "traffic.refund_products"].includes(id)) expect(file.body, `${id} on a store with no orders`).toEqual([]);
      }
    }
  }, 120_000);

  it("never writes a figure as NaN, undefined or Infinity", async () => {
    for (const id of ANALYTICS_TABLE_IDS) {
      const { body } = await csvOf(owner, id);
      for (const row of body) for (const cell of row) expect(cell, id).not.toMatch(/NaN|undefined|Infinity|\[object/);
    }
  }, 120_000);
});

describe("the page's own figures", () => {
  it("writes the net revenue series as the overview reads it, with the previous period lined up bucket by bucket", async () => {
    const ctx = await ctxOf(owner);
    const head = await overviewHead(busy, { period: "7d", compare: "previous" }, fixture.NOW);
    const file = await csvOf(owner, "overview.net_revenue");
    expect(file.header).toEqual(["bucket", "net_revenue", "net_revenue_previous", "currency", "period_from", "period_to", "previous_from", "previous_to"]);
    expect(file.body.map((r) => r[0])).toEqual(head.series.current.map((p) => p.key));
    expect(file.body.map((r) => r[1])).toEqual(head.series.current.map((p) => (p.netRevenueMinor / 100).toFixed(2)));
    expect(file.body.map((r) => r[2])).toEqual((head.series.comparison ?? []).map((p) => (p ? (p.netRevenueMinor / 100).toFixed(2) : "")));
    const [, , , currency, from, to, pFrom, pTo] = file.body[0];
    expect(currency).toBe(head.currency);
    expect([from, to]).toEqual([ctx.params.period.from, lastDayOf(ctx.params.period.to)]);
    const against = ctx.params.compare.previous!;
    expect([pFrom, pTo]).toEqual([against.from, lastDayOf(against.to)]);
  });

  it("has no comparison columns when the address asks for none", async () => {
    const file = await csvOf(owner, "overview.net_revenue", { compare: "none" });
    expect(file.header).toEqual(["bucket", "net_revenue", "currency", "period_from", "period_to"]);
  });

  it("writes a custom range, and the file is named by the table and the days", async () => {
    const file = await csvOf(owner, "overview.net_revenue", { period: "custom", from: "2026-09-01", to: "2026-09-10", compare: "none" });
    expect(file.body[0][file.header.indexOf("period_from")]).toBe("2026-09-01");
    expect(file.body[0][file.header.indexOf("period_to")]).toBe("2026-09-10");
    expect(file.filename).toBe("overview.net_revenue_2026-09-01_2026-09-10.csv");
  });

  it("writes the products table as the products page reads and sorts it, every row and not only the first fifty", async () => {
    const ctx = await ctxOf(owner, { sort: "units", dir: "asc" });
    const against = ctx.params.compare.previous ?? ctx.params.compare.lastYear;
    const report = await productsReport(busy, ctx.params.period, against);
    const expected = sortProducts(report.rows, parseProductsSort({ sort: "units", dir: "asc" }).sort);
    const file = await csvOf(owner, "products.table", { sort: "units", dir: "asc" });
    expect(file.body.map((r) => r[0])).toEqual(expected.map((r) => r.name));
    expect(file.body.map((r) => r[file.header.indexOf("revenue")])).toEqual(expected.map((r) => (r.revenueMinor / 100).toFixed(2)));
    expect(file.header).toContain("revenue_previous");
    expect(file.body.map((r) => r[file.header.indexOf("revenue_previous")])).toEqual(expected.map((r) => (r.previousRevenueMinor === null ? "" : (r.previousRevenueMinor / 100).toFixed(2))));
    // A margin of 42.55 percent is written 42.55, and a figure the page cannot know (no cost entered) is empty, not 0.
    const margin = file.body.map((r) => r[file.header.indexOf("margin")]);
    expected.forEach((r, i) => expect(margin[i]).toBe(r.margin === null ? "" : (Math.round(r.margin * 10_000) / 100).toFixed(2)));
  });

  it("writes the traffic tables from the traffic report, with a missing figure empty", async () => {
    const ctx = await ctxOf(owner);
    const report = await trafficReport(busy, ctx.params.period, fixture.NOW);
    const devices = await csvOf(owner, "traffic.devices");
    expect(devices.body.map((r) => r[0])).toEqual(report.byDevice.map((r) => (r.key === "unknown" ? "Unknown" : r.label)));
    expect(devices.body.map((r) => r[devices.header.indexOf("revenue")])).toEqual(report.byDevice.map((r) => (r.revenueMinor / 100).toFixed(2)));
    const funnel = await csvOf(owner, "traffic.funnel");
    expect(funnel.body.map((r) => r[0])).toEqual(report.funnel.stages.map((s) => s.label));
    expect(funnel.body.map((r) => r[1])).toEqual(report.funnel.stages.map((s) => (s.count === null ? "" : String(s.count))));
  });

  it("writes the inventory as of now, filtered and sorted as its page is, with the day it was made", async () => {
    const out = await csvOf(owner, "inventory.variants", { status: "out", sort: "name", dir: "asc" });
    expect(out.body.length).toBeGreaterThan(0);
    expect(new Set(out.body.map((r) => r[out.header.indexOf("status")]))).toEqual(new Set(["Out of stock"]));
    const names = out.body.map((r) => r[0]);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(out.body[0][out.header.indexOf("period_from")]).toBe(fixture.todayOf(busy));
  });

  it("writes the Nordic dialect with a semicolon, a decimal comma and a byte order mark", async () => {
    const result = await exportAnalyticsTable(owner, "overview.net_revenue", { period: "7d", compare: "none" }, "excel_nordic");
    if (!result.ok) throw new Error(result.message);
    expect(result.csv.startsWith("﻿bucket;net_revenue;currency")).toBe(true);
    expect(result.csv).toMatch(/;\d+,\d\d;/);
  });
});

describe("a currency with no rate", () => {
  it("is left out of the figures, counted for the button's label, and written to the log with the export", async () => {
    // One paid order in SEK, which the store has no rate for.
    const [order] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
      values (${busy.id}::uuid, ${`SEK-${Date.now()}`}, 'SE', 'SEK', 'sv-SE', 'sek@example.com', 'paid', 50000, 0, 0, 10000, 50000, '{}'::jsonb, '{}'::jsonb, ${fixture.at(busy, -2, 12)}::timestamptz) returning id
    `);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
      values (${busy.id}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_sek_${Date.now()}`}, 'acct_insights', 50000, 0, 'SEK', 'captured')
    `);
    const ctx = await ctxOf(owner);
    const built = await buildTable(ctx, "products.table", { period: "7d", compare: "previous" });
    expect(built!.leftOut.orders).toBeGreaterThanOrEqual(1);
    expect(built!.leftOut.currencies).toContain("SEK");
    const before = (await auditRows(busy.id, "analytics.table_exported")).length;
    await csvOf(owner, "products.table");
    const rows = await auditRows(busy.id, "analytics.table_exported");
    expect(rows.length).toBe(before + 1);
    const entry = rows.filter((r) => (r.details as Record<string, unknown>).table === "products.table").at(-1)!;
    const details = entry.details as Record<string, unknown>;
    expect(details).toMatchObject({ table: "products.table", compared: true, leftOutCurrencies: expect.arrayContaining(["SEK"]) });
    expect(Number(details.leftOutOrders)).toBeGreaterThanOrEqual(1);
    // The entry names the table, the period and the counts: never a cell, an email or a name.
    expect(JSON.stringify(details)).not.toMatch(/example\.com|Mug|sek@/);
    expect(entry.area).toBe("analytics");
  });
});

describe("text that starts with a formula character", () => {
  it("is written as text: a product titled =1+1 and a channel named @SUM", async () => {
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${busy.id}::uuid and sku = 'DEMO-TOTE'`);
    const [order] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
      values (${busy.id}::uuid, ${`CAN-${Date.now()}`}, 'NO', ${busy.markets[0].currency}, 'nb-NO', 'canary@example.com', 'paid', 99900, 0, 0, 19980, 99900, '{}'::jsonb, '{}'::jsonb, ${fixture.at(busy, -1, 9)}::timestamptz) returning id
    `);
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${busy.id}::uuid, ${String(order.id)}::uuid, ${String(variant.id)}::uuid, 'DEMO-TOTE', '=1+1 Mug', 1, 99900, 0, 99900, 19980, 0.25, 'txcd_99999999', 'physical')
    `);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
      values (${busy.id}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_can_${Date.now()}`}, 'acct_insights', 99900, 0, ${busy.markets[0].currency}, 'captured')
    `);
    // The page names a product by its title in the store's language: a product whose title starts with a formula character.
    await db().execute(sql`
      update commerce.product_translations set title = '=1+1 Tote'
      where store_id = ${busy.id}::uuid and product_id = (select product_id from commerce.product_variants where id = ${String(variant.id)}::uuid)
    `);
    const top = await csvOf(owner, "overview.top_revenue", { period: "30d" });
    const titled = top.body.find((r) => /1\+1 Tote/.test(r[0]));
    expect(titled?.[0]).toBe("'=1+1 Tote");
    // No text cell of any table starts with an unescaped trigger; a negative amount is a number and may start with a minus.
    for (const id of ANALYTICS_TABLE_IDS) {
      const file = await csvOf(owner, id, { period: "30d" });
      for (const row of file.body) for (const cell of row) if (!/^-\d+(\.\d+)?$/.test(cell)) expect(cell, id).not.toMatch(/^[=+\-@\t\r]/);
    }
  }, 120_000);
});

describe("what the owner entered", () => {
  it("writes the targets of the next months and the spend of the period", async () => {
    const today = fixture.todayOf(busy);
    const saved = await saveTarget(owner, { month: today.slice(0, 7), revenueTarget: "123 456" });
    expect(saved.ok).toBe(true);
    const spent = await addSpend(owner, { day: today, channel: "paid_search", campaign: "=cmd", amount: "250", note: "-note" });
    expect(spent, JSON.stringify(spent)).toMatchObject({ ok: true });
    const targets = await csvOf(owner, "settings.targets");
    expect(targets.body[0].slice(0, 2)).toEqual([today.slice(0, 7), "123456.00"]);
    const spend = await csvOf(owner, "settings.spend", { period: "30d" });
    const entry = spend.body.find((r) => r[spend.header.indexOf("amount")] === "250.00");
    expect(entry?.[spend.header.indexOf("campaign")]).toBe("'=cmd");
    expect(entry?.[spend.header.indexOf("note")]).toBe("'-note");
  });
});

describe("who may download", () => {
  it("needs analytics:write, and the owner role for the top customers and the targets", async () => {
    const reader = member(busy, await makeAccount("reader"), "admin", ["analytics:read"]);
    const writer = member(busy, await makeAccount("writer"), "admin", ["analytics:write"]);
    expect(mayExportTable(owner, "products.table")).toBe(true);
    expect(mayExportTable(owner, "customers.top")).toBe(true);
    expect(mayExportTable(writer, "products.table")).toBe(true);
    expect(mayExportTable(writer, "customers.top")).toBe(false);
    expect(mayExportTable(writer, "settings.targets")).toBe(false);
    expect(mayExportTable(reader, "products.table")).toBe(false);
    const refused = await exportAnalyticsTable(reader, "products.table", { period: "7d" });
    expect(refused).toMatchObject({ ok: false, reason: "forbidden" });
    const refusedPeople = await exportAnalyticsTable(writer, "customers.top", { period: "7d" });
    expect(refusedPeople).toMatchObject({ ok: false, reason: "forbidden" });
    // A table that is not in the registry is not a table.
    expect(await exportAnalyticsTable(owner, "tax.vat", {})).toMatchObject({ ok: false, reason: "unknown" });
    expect(await exportAnalyticsTable(owner, "../../etc", {})).toMatchObject({ ok: false, reason: "unknown" });
    expect(await exportAnalyticsTable(owner, { x: 1 }, {})).toMatchObject({ ok: false, reason: "unknown" });
    // A refused request writes nothing to the log.
    const logged = (await auditRows(busy.id, "analytics.table_exported")).filter((r) => (r.account_id as string) === reader.account.id);
    expect(logged).toEqual([]);
  });

  it("never gives one store's rows to another: the quiet store's tables hold nothing of the busy store", async () => {
    const people = await csvOf(ownerOfQuiet, "customers.top", { period: "30d" });
    expect(people.body).toEqual([]);
    const net = await csvOf(ownerOfQuiet, "overview.net_revenue", { period: "30d" });
    expect(net.body.every((r) => r[1] === "0.00")).toBe(true);
    const mine = await csvOf(owner, "customers.top", { period: "30d" });
    expect(mine.body.map((r) => r[1]).join(" ")).not.toContain(quiet.slug);
    await addMember(quiet.id, owner.account.id, "admin");
    // The busy owner is also a member of the quiet store now, with its own role there: still only that store's rows.
    const asMember = member(quiet, owner.account, "admin", ["analytics:write"]);
    const quietNet = await csvOf(asMember, "overview.net_revenue", { period: "30d" });
    expect(quietNet.body.every((r) => r[1] === "0.00")).toBe(true);
  });
});
