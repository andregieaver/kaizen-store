import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { quarterPeriod } from "@/lib/tax-periods";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const t = await import("./tax-reports-fixture");
const { reconciliation } = await import("./tax-reconciliation");
const { returnView } = await import("./tax-reports");

afterAll(async () => {
  await closeDb();
});

const Q3 = quarterPeriod(2026, 3);

describe("money review: the main-currency bridge", () => {
  it("does not call the whole VAT of a document with no stored rate an exchange-rate difference", async () => {
    const own = await t.sellerStore("money-nofx");
    await t.paidOn(own, "2026-09-15", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
    await t.issueBackdated(own.storeId);
    // The store moves its home to Norway: main currency NOK, the DKK invoice holds no conversion to it. NOK and DKK both have a rate today.
    await db().execute(sql`update commerce.stores set country = 'NO' where id = ${own.storeId}::uuid`);
    await db().execute(sql`insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${own.storeId}::uuid, 'NOK', 11.5, 1, 4) on conflict do nothing`);
    const store = (await fx.ownerOf(own)).store;
    const view = await reconciliation(store, { from: Q3.from, to: Q3.to });
    const exchange = view.main.lines.find((l) => l.kind === "exchange_rate");
    // The invoice's VAT (250.00 DKK) is simply not in the report's main-currency figure (no stored rate): that is not an exchange-rate difference.
    expect(view.main.reportMainMinor).toBe(0);
    expect(exchange?.taxMinor ?? 0).toBe(0);
  }, 60_000);
});

describe("money review: a filed quarter is not reclassified by a later edit of the store's own settings", () => {
  it("keeps a download sold to Germany in part 2a of Q3 after the store's country is changed", async () => {
    const own = await t.sellerStore("money-reclass");
    await t.insertEcb("2026-09-30", t.ECB_2026_09_30);
    await t.paidOn(own, "2026-09-15", [["DEMO-LAMP", 1]], { market: t.markets.de });
    await t.issueBackdated(own.storeId);
    let store = (await fx.ownerOf(own)).store;
    const before = await returnView(store, "oss", Q3, "filing");
    expect(before.data.part2.map((l) => [l.part, l.memberState, l.vatEur])).toEqual([["2a", "DE", 1900]]);
    await db().execute(sql`update commerce.stores set country = 'NO' where id = ${own.storeId}::uuid`);
    store = (await fx.ownerOf(own)).store;
    const after = await returnView(store, "oss", Q3, "filing");
    expect(after.data.part2.map((l) => [l.part, l.memberState, l.vatEur])).toEqual([["2a", "DE", 1900]]);
  }, 60_000);
});
