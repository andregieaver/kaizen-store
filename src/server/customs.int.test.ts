import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";
import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { listDutyRates, removeDutyRate, saveDutyRate, setDutyRateVerified } = await import("./duty-rates");
const { customsMarkets, dutyRowsFor, productsWithoutHsCode, saveCustomsSetting } = await import("./customs");
const { runOwnerTool } = await import("./owner-tools");

type Row = Record<string, unknown>;

/**
 * Customs and duties (wave 7 unit I, D343): the platform's rates table written only by platform admins through `src/server/duty-rates.ts` (each
 * change audited), a store's DDP or DAP choice per country written only through `saveCustomsSetting()` and never reaching another store, and the
 * AI manager's read-only `customs_duties` answering from the cart's own decision.
 */

let fx: Fixture;
let other: Fixture;
let admin: Account;
let staff: Account;
/** A destination no real row uses, so this file's rows reach nothing else. */
const DEST = "XQ";

beforeAll(async () => {
  fx = await makeStore("customs");
  other = await makeStore("customs-other");
  const run = Date.now().toString(36);
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`duty-admin-${run}@example.com`}, 'Admin', true) returning id`);
  admin = { id: String(a.id), email: `duty-admin-${run}@example.com`, name: "Admin", platformAdmin: true };
  staff = { id: fx.ownerId, email: fx.ownerEmail, name: "Kari", platformAdmin: false };
}, 120_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.duty_rates where destination = ${DEST}`);
  await closeDb();
});

const heading = (o: Record<string, unknown> = {}) => ({
  destination: DEST,
  hsPrefix: "610910",
  dutyRateBps: 1200,
  source: "https://www.trade-tariff.service.gov.uk/commodities/6109100010",
  checkedOn: "2026-10-27",
  ...o,
});

describe("the platform's duty rates", () => {
  it("are written by platform admins only, each change audited", async () => {
    expect(await saveDutyRate(staff, heading())).toEqual({ ok: false, problems: ["Only a platform admin can change duty rates."] });
    expect((await listDutyRates()).filter((r) => r.destination === DEST)).toEqual([]);

    const saved = await saveDutyRate(admin, heading());
    expect(saved).toMatchObject({ ok: true });
    const id = (saved as { id: string }).id;
    const [row] = (await listDutyRates()).filter((r) => r.destination === DEST);
    expect(row).toMatchObject({ id, hsPrefix: "610910", dutyRateBps: 1200, origin: null, appliesTo: "any", verified: false, checkedOn: "2026-10-27" });
    const [entry] = await db().execute<Row>(sql`
      select store_id, area, details from commerce.audit_log where action = 'platform.duty_rate_saved' and target_id = ${id} order by created_at desc limit 1
    `);
    expect(entry).toMatchObject({ store_id: null, area: "platform", details: expect.objectContaining({ destination: DEST, hsPrefix: "610910", created: true }) });

    expect(await setDutyRateVerified(staff, id, true)).toMatchObject({ ok: false });
    expect(await setDutyRateVerified(admin, id, true)).toEqual({ ok: true });
    expect((await dutyRowsFor(DEST)).find((r) => r.id === id)?.verified).toBe(true);

    expect(await saveDutyRate(admin, heading({ dutyRateBps: 1000, origin: "EU" }), id)).toMatchObject({ ok: true, id });
    expect((await dutyRowsFor(DEST)).find((r) => r.id === id)).toMatchObject({ dutyRateBps: 1000, origin: "EU", verified: false });

    expect(await removeDutyRate(staff, id)).toMatchObject({ ok: false });
    expect(await removeDutyRate(admin, id)).toEqual({ ok: true });
    expect(await dutyRowsFor(DEST)).toEqual([]);
    expect(await removeDutyRate(admin, id)).toMatchObject({ ok: false });
  });

  it("refuses a row the table would not hold, with the reason", async () => {
    expect(await saveDutyRate(admin, heading({ dutyRateBps: null }))).toMatchObject({ ok: false, problems: [expect.stringMatching(/duty rate/)] });
    expect(await saveDutyRate(admin, heading({ hsPrefix: "", dutyRateBps: null, origin: "CN" }))).toMatchObject({ ok: false, problems: [expect.stringMatching(/every origin/)] });
    expect(await saveDutyRate(admin, heading({ thresholdMinor: 13_500 }))).toMatchObject({ ok: false });
    expect(await saveDutyRate(admin, heading({ source: "not an address" }))).toMatchObject({ ok: false, problems: [expect.stringMatching(/address/)] });
    expect(await saveDutyRate(admin, heading({ dutyRateBps: "12.555" }))).toMatchObject({ ok: false });
    // The database's own checks hold too, whoever writes.
    await expect(
      db().execute(sql`insert into commerce.duty_rates (destination, hs_prefix, duty_rate_bps, threshold_minor, threshold_currency, source, checked_on)
                       values (${DEST}, '6109', 1200, 100, 'GBP', 'https://example.test', current_date)`),
    ).rejects.toThrow();
    expect(await dutyRowsFor(DEST)).toEqual([]);
  });

  it("start with rows that cite their sources and are all unverified, the EU's end of the 150 EUR relief as a dated rule", async () => {
    const eu = await dutyRowsFor("SE");
    const scheme = eu.filter((r) => r.destination === "EU" && r.appliesTo === "scheme");
    expect(scheme.map((r) => [r.validFrom, r.validTo, r.perItemMinor, r.thresholdMinor])).toEqual(
      expect.arrayContaining([
        [null, "2026-06-30", null, 15_000],
        ["2026-07-01", null, 300, 15_000],
      ]),
    );
    const starters = (await listDutyRates()).filter((r) => r.destination !== DEST);
    expect(starters.length).toBeGreaterThan(0);
    expect(starters.every((r) => r.source.startsWith("https://") && !r.verified)).toBe(true);
  });
});

describe("a store's choice per country", () => {
  it("is saved only for the store's own countries that cross a border, and never reaches another store", async () => {
    expect(await saveCustomsSetting(fx.ownerId, fx.storeId, { market: "SE", mode: "ddp", vatScheme: false }, "NO")).toEqual({ ok: true });
    expect(await saveCustomsSetting(fx.ownerId, fx.storeId, { market: "NO", mode: "ddp" }, "NO")).toEqual({ ok: false, problem: "no_border" });
    expect(await saveCustomsSetting(fx.ownerId, fx.storeId, { market: "US", mode: "ddp" }, "NO")).toEqual({ ok: false, problem: "not_found" });
    expect(await saveCustomsSetting(fx.ownerId, fx.storeId, { market: "SE", mode: "sometimes" }, "NO")).toEqual({ ok: false, problem: "invalid" });

    const mine = await customsMarkets(fx.storeId, "NO");
    expect(mine.find((m) => m.code === "SE")).toMatchObject({ mode: "ddp", crosses: true, inTable: true });
    expect(mine.find((m) => m.code === "NO")).toMatchObject({ mode: "dap", crosses: false });
    const theirs = await customsMarkets(other.storeId, "NO");
    expect(theirs.find((m) => m.code === "SE")).toMatchObject({ mode: "dap" });
    const [rows] = await db().execute<Row>(sql`select count(*)::int as n from commerce.customs_settings where store_id = ${other.storeId}::uuid`);
    expect(rows.n).toBe(0);

    // Another store's owner saving for their own store changes only theirs.
    expect(await saveCustomsSetting(other.ownerId, other.storeId, { market: "DK", mode: "ddp" }, "NO")).toEqual({ ok: true });
    expect((await customsMarkets(fx.storeId, "NO")).find((m) => m.code === "DK")).toMatchObject({ mode: "dap" });

    // Back to DAP with no scheme keeps no row.
    expect(await saveCustomsSetting(fx.ownerId, fx.storeId, { market: "SE", mode: "dap" }, "NO")).toEqual({ ok: true });
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.customs_settings where store_id = ${fx.storeId}::uuid`);
    expect(left.n).toBe(0);
    const [audited] = await db().execute<Row>(sql`select area from commerce.audit_log where store_id = ${fx.storeId}::uuid and action = 'shipping.customs_saved' limit 1`);
    expect(audited).toMatchObject({ area: "settings" });
  });

  it("counts the products a DDP checkout would refuse", async () => {
    const before = await productsWithoutHsCode(fx.storeId);
    await db().execute(sql`update commerce.product_variants set hs_code = null where store_id = ${fx.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    expect(await productsWithoutHsCode(fx.storeId)).toBe(before + 1);
    expect(await productsWithoutHsCode(other.storeId)).toBe(before);
  });
});

describe("the AI manager's customs_duties", () => {
  it("says who pays, each product's HS code and an estimate, from the cart's own decision", async () => {
    const c = { ...(await ownerOf(fx)), invalidate: () => {} };
    // The EU's thresholds are in euro: a krona amount is compared through the store's rates (or the ECB's, which the daily job keeps).
    await db().execute(sql`insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${fx.storeId}::uuid, 'SEK', 11.5, 1, 2) on conflict do nothing`);
    const answer = (await runOwnerTool(c, "customs_duties", { country: "SE", products: ["demo-notatbok", "demo-keramikkopp"] })) as {
      crosses_customs_border: boolean;
      who_pays: string;
      products: { handle: string; hs_code: string | null; estimate: { duty: string; verified: boolean } | null; why_none?: string }[];
    };
    expect(answer.crosses_customs_border).toBe(true);
    expect(answer.who_pays).toMatch(/^DAP/);
    const notebook = answer.products.find((p) => p.handle === "demo-notatbok");
    expect(notebook).toMatchObject({ hs_code: "482010", estimate: { verified: false } });
    await expect(runOwnerTool(c, "customs_duties", { country: "US" })).rejects.toThrow(/not one of the store's countries/);
  });
});
