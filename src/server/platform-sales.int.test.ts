import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const sales = await import("./platform-sales");

type Row = Record<string, unknown>;

/**
 * What Kaizena Flow itself sold (D507) against a real database, with Stripe as a stand-in: a paid plan invoice is kept once with the store
 * that bought it and its country, a credit note's amount lands on it, a premium theme is known by its purchase, and the year's view sums
 * them by month, live and test apart.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

const paidAt = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("what Kaizena Flow sold (D507)", () => {
  it("keeps paid invoices once, with their buyer and credit notes, and sums the year", async () => {
    const name = `sales-${run}`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Salg') returning id`);
    await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Salg', null)`);
    const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
    const storeId = String(store.id);
    const account = `acct_${run}`;
    await db().execute(sql`update commerce.stores set country = 'NO' where id = ${storeId}::uuid`);
    await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id) values (${storeId}::uuid, 'test', ${account}) on conflict do nothing`);
    const [linked] = await db().execute<Row>(sql`select account_id from commerce.stripe_accounts where store_id = ${storeId}::uuid and mode = 'test'`);

    const plan = {
      id: `in_${run}plan`,
      number: "KF-0001",
      currency: "nok",
      total: 37_375,
      subtotal: 29_900,
      total_excluding_tax: 29_900,
      created: paidAt("2026-10-31T23:30:00Z"),
      status_transitions: { paid_at: paidAt("2026-10-31T23:30:00Z") },
      parent: { type: "subscription_details" },
      customer_account: String(linked.account_id),
    };
    const event = (type: string, object: unknown) => ({ type, data: { object } }) as unknown as Stripe.Event;
    expect(await sales.applyPlatformSaleEvent("test", event("invoice.paid", plan))).toBe(true);
    expect(await sales.applyPlatformSaleEvent("test", event("invoice.paid", plan))).toBe(true);
    const theme = { ...plan, id: `in_${run}theme`, number: "KF-0002", total: 61_250, subtotal: 49_000, total_excluding_tax: 49_000, parent: null, metadata: { kaizen_theme_purchase: "p1" } };
    expect(await sales.applyPlatformSaleEvent("test", event("invoice.paid", { ...theme, status_transitions: { paid_at: paidAt("2026-11-02T09:00:00Z") } }))).toBe(true);
    // Nothing for an invoice that charged nothing, or an event that is no sale.
    expect(await sales.applyPlatformSaleEvent("test", event("invoice.paid", { ...plan, id: `in_${run}free`, total: 0 }))).toBe(false);
    expect(await sales.applyPlatformSaleEvent("test", event("invoice.created", plan))).toBe(false);

    const rows = await db().execute<Row>(sql`
      select stripe_invoice_id, buyer_store_id, kind, country, currency, net_minor::int as net, vat_minor::int as vat, total_minor::int as total
        from commerce.platform_sales where stripe_invoice_id like ${`in_${run}%`} order by stripe_invoice_id`);
    expect(rows.map((r) => [r.kind, r.buyer_store_id, r.country, r.currency, r.net, r.vat, r.total])).toEqual([
      ["plan", storeId, "NO", "NOK", 29_900, 7_475, 37_375],
      ["theme", storeId, "NO", "NOK", 49_000, 12_250, 61_250],
    ]);

    // A credit note for the whole plan, as Stripe lists it (a void one not counted).
    const stripe = { creditNotes: { list: async function* () {
      yield { status: "issued", total: 37_375 };
      yield { status: "void", total: 10_000 };
    } } } as unknown as Stripe;
    await sales.recordPlatformCredits("test", plan.id, stripe);
    const [credited] = await db().execute<Row>(sql`select credited_minor::int as c from commerce.platform_sales where stripe_invoice_id = ${plan.id}`);
    expect(credited.c).toBe(37_375);

    // The year, in Oslo's time: the plan paid 31 October 23:30 UTC is November's; live has none of these.
    const view = await sales.platformSalesView(2026);
    const nov = view.test.months.find((m) => m.month === "2026-11" && m.currency === "NOK")!;
    expect(nov.byKind.plan).toBeGreaterThanOrEqual(29_900);
    expect(nov.byKind.theme).toBeGreaterThanOrEqual(49_000);
    expect(nov.credited).toBeGreaterThanOrEqual(37_375);
    expect(view.live.months.some((m) => m.byKind.theme >= 49_000 && m.month === "2026-11")).toBe(false);

    // The database holds what a sale is: VAT and before VAT make its total, and no more credited than paid.
    await expect(db().execute(sql`update commerce.platform_sales set vat_minor = 1 where stripe_invoice_id = ${plan.id}`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.platform_sales set credited_minor = 999999 where stripe_invoice_id = ${plan.id}`)).rejects.toThrow();
    await db().execute(sql`delete from commerce.platform_sales where stripe_invoice_id like ${`in_${run}%`}`);
    await db().execute(sql`delete from commerce.stripe_accounts where account_id = ${account}`);
  });
});
