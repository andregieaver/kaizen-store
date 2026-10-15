import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { staffSummaryFigures } = await import("./staff-summary");
const { periodTotals } = await import("./analytics-totals");
const { getStore } = await import("./stores");
const { fxStore, paidOrder, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * The staff summary's figures (D238, `docs/analytics.md` *Staff summary*), against a real database: the period's orders and net sales are D152's
 * `periodTotals()` exactly (a euro order converted at the store's rate, a currency without a rate counted and left out), and what is open now is counted
 * for the store alone.
 */

let fx: Awaited<ReturnType<typeof fxStore>>;
let today: string;

beforeAll(async () => {
  fx = await fxStore("summary");
  today = String((await db().execute<Row>(sql`select to_char((now() at time zone 'Europe/Oslo')::date, 'YYYY-MM-DD') as d`))[0].d);
});
afterAll(async () => {
  await closeDb();
});

describe("staffSummaryFigures()", () => {
  it("is periodTotals() for the period, in the main currency, with a euro order converted, and counts what is open", async () => {
    await paidOrder(fx, [["DEMO-TOTE", 2]]);
    await paidOrder(fx, [["DEMO-TOTE", 1]], { market: NO_EUR });
    const store = (await getStore(fx.slug))!;
    const figures = await staffSummaryFigures(store, { from: today, to: today });
    const totals = await periodTotals(store, customPeriod(today, today));
    expect(figures.orders).toBe(totals.totals.orders);
    expect(figures.orders).toBe(2);
    expect(figures.netSalesMinor).toBe(totals.totals.revenueMinor - totals.totals.refundsMinor);
    expect(figures.currency).toBe("NOK");
    expect(figures.unconverted).toBe(0);
    expect(figures.toSend).toBe(2);
    expect(figures.supportWaiting).toBeNull();
  });

  it("counts an order in a currency without a rate as left out, never summed", async () => {
    const other = await fxStore("summary-norate");
    await paidOrder(other, [["DEMO-TOTE", 1]], { market: NO_EUR });
    // The main currency without a rate: a euro amount cannot be converted into it.
    await db().execute(sql`update commerce.store_currencies set rate = null where store_id = ${other.storeId}::uuid and currency = 'NOK'`);
    const store = (await getStore(other.slug))!;
    const figures = await staffSummaryFigures(store, { from: today, to: today });
    const totals = await periodTotals(store, customPeriod(today, today));
    expect(totals.unconverted).toBeGreaterThan(0);
    expect(figures.unconverted).toBe(totals.unconverted);
    expect(figures.missingCurrencies).toEqual(totals.missingCurrencies);
    expect(figures.netSalesMinor).toBe(totals.totals.revenueMinor - totals.totals.refundsMinor);
  });
});
