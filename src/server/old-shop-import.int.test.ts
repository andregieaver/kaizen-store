import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { Cell } from "@/lib/csv";

import { auditOf, csvBytes, depsWith, fakeStorage, importThrough, itemsOf, jobRow, runToEnd } from "./data-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const jobs = await import("./data-jobs");
const staff = await import("./customer-staff");
const { newStore } = await import("./inventory-test-support");

/**
 * Moving from another shop (wave 11 unit E, D384): WooCommerce's product file is imported like Shopify's, and each product made leaves a
 * redirect from its old address; Shopify's order export becomes history, copied orders that nothing pays, emails, invoices or counts, tied
 * to a customer only by an email the store already has, and imported again as `already`.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const mail = (name: string) => `${name}-${run}@example.com`;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("oldshop");
  other = await newStore("oldshop-other");
});

afterAll(async () => {
  await closeDb();
});

const count = async (query: ReturnType<typeof sql>): Promise<number> => Number(((await db().execute<Row>(query))[0] as Row).n);

describe("a WooCommerce product file", () => {
  const HEADER = ["ID", "Type", "SKU", "Name", "Published", "Description", "Stock", "Regular price", "Sale price", "Categories", "Parent", "Attribute 1 name", "Attribute 1 value(s)"];
  const rows: Cell[][] = [
    ["10", "simple", `WOO-${run}`, `Blå kopp ${run}`, "1", "<p>Stoneware</p>", "4", "249", "", "Kitchen", "", "", ""],
    ["20", "variable", `TEE-${run}`, `Tee ${run}`, "0", "A tee", "", "", "", "", "", "Size", "S, M"],
    ["21", "variation", `TEE-${run}-S`, "", "", "", "3", "199", "149", "", "id:20", "Size", "S"],
    ["22", "variation", `TEE-${run}-M`, "", "", "", "1", "199", "", "", "id:20", "Size", "M"],
    ["30", "grouped", "", "Set", "1", "", "", "", "", "", "", "", ""],
  ];

  it("creates its products with their variations and prices, and leaves a redirect from each old address", async () => {
    const storage = fakeStorage();
    const done = await importThrough(store.member, storage, csvBytes([HEADER, ...rows]), { pricesIncludeVat: true }, { name: "woo.csv" });
    expect(done.checked.format).toBe("woocommerce");
    const items = await itemsOf(done.jobId);
    const made = items.filter((i) => i.outcome === "created" || i.outcome === "drafted").map((i) => i.ref);
    expect(made).toEqual(expect.arrayContaining([`bla-kopp-${run}`, `tee-${run}`]));
    expect(items.flatMap((i) => i.messages.map((m) => m.code))).toEqual(expect.arrayContaining(["woocommerce.type_skipped", "redirect.made"]));
    const [tee] = await db().execute<Row>(sql`
      select count(v.*)::int as n from commerce.products p join commerce.product_variants v on v.product_id = p.id
      where p.store_id = ${store.storeId}::uuid and p.handle = ${`tee-${run}`}
    `);
    expect(tee.n).toBe(2);
    const redirects = await db().execute<Row>(sql`select source, kind, origin from commerce.redirects where store_id = ${store.storeId}::uuid and source like '/product/%' order by source`);
    expect(redirects.map((r) => r.source)).toEqual([`/product/bla-kopp-${run}`, `/product/tee-${run}`]);
    expect(redirects.every((r) => r.kind === "manual" && r.origin === "import")).toBe(true);
  });

  it("makes no redirect when the owner says so", async () => {
    const storage = fakeStorage();
    const own = [["40", "simple", `CAP-${run}`, `Cap ${run}`, "0", "", "1", "99", "", "", "", "", ""]];
    await importThrough(store.member, storage, csvBytes([HEADER, ...own]), { pricesIncludeVat: true, redirects: false }, { name: "woo.csv" });
    expect(await count(sql`select count(*)::int as n from commerce.redirects where store_id = ${store.storeId}::uuid and source = ${`/product/cap-${run}`}`)).toBe(0);
  });
});

describe("an order history from Shopify", () => {
  const HEADER = ["Name", "Email", "Financial Status", "Fulfillment Status", "Currency", "Subtotal", "Shipping", "Taxes", "Total", "Discount Amount", "Created at", "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem sku", "Billing Name", "Billing Address1", "Billing City", "Billing Zip", "Billing Country"];
  const file: Cell[][] = [
    [`#A${run}`, mail("Known").toUpperCase(), "paid", "fulfilled", "NOK", "450.00", "49.00", "99.80", "499.00", "0", "2025-03-01T10:00:00Z", "2", "Cup", "225.00", "CUP-1", "Known Person", "Street 1", "Oslo", "0150", "NO"],
    [`#A${run}`, "", "", "", "", "", "", "", "", "", "", "1", "Saucer", "0", "", "", "", "", "", ""],
    [`#B${run}`, mail("stranger"), "refunded", "", "EUR", "10.00", "0", "2.00", "10.00", "0", "2025-04-01T10:00:00Z", "1", "Tea", "10.00", "TEA", "", "", "", "", ""],
    [`#C${run}`, "", "paid", "", "NOK", "1.00", "0", "0", "1.00", "0", "2025-04-01T10:00:00Z", "1", "Bad", "1.00", "", "", "", "", "", ""],
  ];

  async function importHistory(member: typeof store.member, rows: Cell[][], apply = true) {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const started = await jobs.startHistoryUpload(member, "orders.csv", deps);
    if (!started.ok) throw new Error(started.problem);
    storage.files.set(`imports/${started.path}`, csvBytes([HEADER, ...rows]));
    const registered = await jobs.registerHistoryImport(member, { path: started.path, name: "orders.csv" }, deps);
    if (!registered.ok) throw new Error(registered.problems.join(" "));
    const jobId = registered.jobId;
    const check = await jobs.startHistoryCheck(member, jobId, deps);
    if (!check.ok) throw new Error(check.problem);
    expect(await runToEnd(jobId, deps)).toBe("checked");
    const dry = jobs.historyDryCountsOf({ counts: (await jobRow(jobId)).counts as Record<string, unknown> });
    if (apply) {
      const go = await jobs.startHistoryApply(member, jobId, deps);
      if (!go.ok) throw new Error(go.problem);
      expect(await runToEnd(jobId, deps)).toBe("done");
    }
    return { jobId, dry };
  }

  it("checks without writing, then imports copied orders that nothing pays, invoices or counts, tied to a customer only by an email the store has", async () => {
    const made = await staff.createCustomer(store.member, { email: mail("known") });
    if (!made.ok) throw new Error("customer");
    const checked = await importHistory(store.member, file, false);
    expect(checked.dry).toEqual({ toCreate: 2, already: 0, withProblems: 1 });
    expect(await count(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid and copied_from is not null`)).toBe(0);
    await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where id = ${checked.jobId}::uuid`);

    const done = await importHistory(store.member, file);
    const orders = await db().execute<Row>(sql`
      select number, status, currency, total_minor, subtotal_minor, shipping_minor, tax_minor, customer_id, email, copied_from, billing_address
      from commerce.orders where store_id = ${store.storeId}::uuid and copied_from is not null order by number
    `);
    expect(orders.map((o) => [o.number, o.status, o.currency, Number(o.total_minor)])).toEqual([
      [`C-A${run}`, "fulfilled", "NOK", 49_900],
      [`C-B${run}`, "cancelled", "EUR", 1_000],
    ]);
    // The total is the file's; the subtotal is worked out so the order adds up.
    expect(Number(orders[0].subtotal_minor) + Number(orders[0].shipping_minor)).toBe(49_900);
    expect(orders[0].customer_id).toBe(made.id);
    expect(orders[1].customer_id).toBeNull();
    expect(orders[0].billing_address).toMatchObject({ line1: "Street 1", city: "Oslo", country: "NO" });
    expect(await count(sql`select count(*)::int as n from commerce.customers where store_id = ${store.storeId}::uuid and email = ${mail("stranger")}`)).toBe(0);
    const ids = sql`(select id from commerce.orders where store_id = ${store.storeId}::uuid and copied_from is not null)`;
    expect(await count(sql`select count(*)::int as n from commerce.order_lines where order_id in ${ids}`)).toBe(3);
    // History: no payment, invoice, staff alert, integration event or paid event.
    expect(await count(sql`select count(*)::int as n from commerce.payments where order_id in ${ids}`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from commerce.invoices where order_id in ${ids}`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from commerce.store_events where store_id = ${store.storeId}::uuid`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from commerce.order_events where order_id in ${ids} and type <> 'copied'`)).toBe(0);
    // A copied order is history and is never changed.
    await expect(db().execute(sql`update commerce.orders set status = 'paid' where number = ${`C-B${run}`} and store_id = ${store.storeId}::uuid`)).rejects.toThrow();
    // The log carries counts, never a person's email.
    const [entry] = (await auditOf(store.storeId, "order.history_imported")).slice(-1);
    expect(JSON.stringify(entry)).not.toContain("example.com");
    expect(entry.details).toMatchObject({ created: 2, failed: 1 });
    const codes = (await itemsOf(done.jobId)).flatMap((i) => i.messages.map((m) => m.code));
    expect(codes).toContain("history.problem");
  });

  it("leaves an order already imported as it is, and reaches no other store", async () => {
    const again = await importHistory(store.member, file, false);
    expect(again.dry).toEqual({ toCreate: 0, already: 2, withProblems: 1 });
    expect(await jobs.startHistoryApply(store.member, again.jobId, depsWith(fakeStorage()))).toMatchObject({ ok: false });
    await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where id = ${again.jobId}::uuid and status <> 'done'`);
    expect(await count(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid and copied_from is not null`)).toBe(2);
    expect(await count(sql`select count(*)::int as n from commerce.orders where store_id = ${other.storeId}::uuid and copied_from is not null`)).toBe(0);
    expect(await jobs.jobFor(other.member, again.jobId)).toBeNull();
  });

  it("is the owner's only", async () => {
    const admin = { ...store.member, role: "admin", permissions: ["orders:read", "orders:write"] } as typeof store.member;
    expect(await jobs.startHistoryUpload(admin, "orders.csv", depsWith(fakeStorage()))).toMatchObject({ ok: false });
  });
});
