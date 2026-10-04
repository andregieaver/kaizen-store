import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { monthPeriod, quarterPeriod } from "@/lib/tax-periods";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fx = await import("./invoice-test-fixture");
type Fixture = Awaited<ReturnType<typeof fx.makeStore>>;
const t = await import("./tax-reports-fixture");
const ownerTools = await import("./owner-tools");
const { returnView, vatReport } = await import("./tax-reports");
const { reconciliation } = await import("./tax-reconciliation");
const { taxReturnsAttention } = await import("./tax-returns-attention");
const { exportReturnData } = await import("./tax-report-exports");
const { controlCenter } = await import("./control-center");

/**
 * The AI manager's VAT, OSS and IOSS report tools and the OSS and IOSS attention item (D161, `docs/wave-1c-reports.md` 2.2, 5.4), against a real
 * database: the answers are the page's own figures written by `formatMoney`, an incomplete return says what is missing and never zero, no buyer
 * field is in any answer, another store's documents are never seen, a member without the analytics area is refused, and the attention item
 * is the owner's, names only what Kaizen knows and goes quiet once Return data is exported in filing mode.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

afterAll(async () => {
  await closeDb();
});

const Q3 = quarterPeriod(2026, 3);
const RANGE = { from: Q3.from, to: Q3.to };

let own: Fixture;
let other: Fixture;
let bare: Fixture;
let noRate: Fixture;
let noSales: Fixture;
let ioss: Fixture;

const run = async (f: Fixture, name: string, input: unknown = {}, holder?: { role: "owner" | "admin"; permissions?: string[] | null }): Promise<Json> => {
  const m = await fx.ownerOf(f);
  return (await ownerTools.runOwnerTool({ account: m.account, store: m.store, invalidate: () => {}, holder }, name, input)) as Json;
};
const storeOf = async (f: Fixture) => (await fx.ownerOf(f)).store;

beforeAll(async () => {
  await t.insertEcb("2026-09-30", t.ECB_2026_09_30);
  own = await t.sellerStore("tool-tax");
  await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
  await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
  await t.issueBackdated(own.storeId);

  other = await t.sellerStore("tool-tax-other");
  await t.paidOn(other, "2026-09-14", [["DEMO-MUG-WHITE", 3]], { market: t.markets.de });
  await t.issueBackdated(other.storeId);

  bare = await fx.makeStore("tool-tax-bare");

  // A Danish sale in June: no ECB rate is stored for 30 June, so the return cannot be made in euro.
  noRate = await t.sellerStore("tool-tax-norate");
  await t.paidOn(noRate, "2026-06-10", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
  await t.issueBackdated(noRate.storeId);

  // Registered for OSS and with nothing sold.
  noSales = await t.sellerStore("tool-tax-nosales");

  // Registered for IOSS (its own return, no intermediary), a consignment to Sweden in September.
  ioss = await t.sellerStore("tool-tax-ioss", { country: "NO", ioss: { number: "IM1234567890", markets: ["SE", "DK", "DE"] } });
  await t.paidOn(ioss, "2026-09-10", [["DEMO-MUG-WHITE", 1]], { market: t.markets.se });
  await t.issueBackdated(ioss.storeId);
}, 180_000);

describe("vat_report", () => {
  it("gives the page's own figures, written by formatMoney: totals in the main currency at each document's stored rate, per country, rate and basis", async () => {
    const store = await storeOf(own);
    const view = await vatReport(store, RANGE);
    const main = view.report.mainCurrency;
    expect(main).toBe("SEK");
    const answer = await run(own, "vat_report", { from: "2026-07-01", to: "2026-09-30" });

    expect(answer.period).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(answer.made_from).toEqual({ invoices: 2, credit_notes: 0, orders_with_an_invoice: 2 });
    const locale = store.markets[0].locale;
    expect(answer.totals_in_main_currency).toMatchObject({
      currency: "SEK",
      vat_charged: formatMoney(view.report.totals.vatChargedMainMinor, "SEK", locale),
      vat_credited: formatMoney(0, "SEK", locale),
      vat_after_credits: formatMoney(view.report.totals.vatAfterMainMinor, "SEK", locale),
    });
    // 19.00 EUR at 11 SEK and 250.00 DKK at 11 / 7.5: the unit of the worked example.
    expect(view.report.totals.vatChargedMainMinor).toBe(20_900 + 36_667);

    expect(answer.by_country_rate_and_basis).toHaveLength(view.report.rows.length);
    const dk = answer.by_country_rate_and_basis.find((r: Json) => r.country === "DK")!;
    expect(dk).toMatchObject({
      rate: "25 %",
      basis: "standard",
      currency: "DKK",
      reported_in: "OSS Union scheme, part 2b",
      invoices: 1,
      net: formatMoney(100_000, "DKK", locale),
      vat_charged: formatMoney(25_000, "DKK", locale),
      vat_after_credits: formatMoney(25_000, "DKK", locale),
      vat_after_credits_in_main_currency: formatMoney(36_667, "SEK", locale),
    });
    // A euro row is in a currency other than the main one too, and has its main-currency figure.
    const de = answer.by_country_rate_and_basis.find((r: Json) => r.country === "DE")!;
    expect(de).toMatchObject({ currency: "EUR", vat_charged: formatMoney(1_900, "EUR", locale), vat_after_credits_in_main_currency: formatMoney(20_900, "SEK", locale) });
    expect(answer.per_document_currency.map((c: Json) => c.currency).sort()).toEqual(["DKK", "EUR"]);
  });

  it("says the reconciliation with Finance is equal when every difference is named, and that it is not a tax return, nothing is filed and no file is made", async () => {
    const store = await storeOf(own);
    const answer = await run(own, "vat_report", { from: "2026-07-01", to: "2026-09-30" });
    const recon = await reconciliation(store, RANGE);
    expect(answer.reconciliation_with_finance.result).toBe(recon.sentence);
    expect(answer.reconciliation_with_finance.equal).toBe(true);
    expect(answer.reconciliation_with_finance.per_currency.map((b: Json) => [b.currency, b.balanced])).toEqual(recon.bridges.map((b) => [b.currency, true]));
    expect(answer.paid_orders_without_a_document).toBeUndefined();
    expect(answer.not_a_tax_return).toMatch(/not a tax return/);
    expect(answer.not_a_tax_return).toMatch(/files nothing/);
    expect(answer.export).toMatch(/cannot make a file/);
    expect(answer.page).toBe(`/admin/${own.slug}/analytics/tax?view=vat`);
  });

  it("never gives a buyer's name, address or email, nor another store's documents", async () => {
    const text = JSON.stringify(await run(own, "vat_report", { from: "2026-07-01", to: "2026-09-30" })) + JSON.stringify(await run(own, "oss_return_data", { period: "2026-Q3" }));
    expect(text).not.toMatch(/Kari|Nordmann|Kirkeveien|@example\.com|shopper-|Storgatan|556677889901|SE556677889901/);
    // The other store sold three mugs to Germany (57.00 EUR VAT) in the same quarter: this store's answer has only its own two invoices.
    const theirs = await run(other, "vat_report", { from: "2026-07-01", to: "2026-09-30" });
    expect(theirs.made_from).toEqual({ invoices: 1, credit_notes: 0, orders_with_an_invoice: 1 });
    expect(JSON.stringify(theirs.by_country_rate_and_basis)).toContain(formatMoney(5_700, "EUR", (await storeOf(other)).markets[0].locale));
    expect(text).not.toContain(formatMoney(5_700, "EUR", (await storeOf(own)).markets[0].locale));
  });

  it("is an empty answer for a store with no documents, with no figure invented and nothing hidden", async () => {
    const answer = await run(bare, "vat_report", { period: "last_quarter" });
    expect(answer.made_from).toEqual({ invoices: 0, credit_notes: 0, orders_with_an_invoice: 0 });
    expect(answer.by_country_rate_and_basis).toEqual([]);
    expect(answer.per_document_currency).toEqual([]);
    expect(answer.reconciliation_with_finance.equal).toBe(true);
  });

  it("names a named period in the store's days, and refuses half a range or a backwards one in words", async () => {
    const answer = await run(own, "vat_report", { period: "last_quarter" });
    expect(answer.period).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(answer.made_from.invoices).toBe(2);
    await expect(run(own, "vat_report", { from: "2026-07-01" })).rejects.toThrow(/both/);
    await expect(run(own, "vat_report", { from: "2026-09-30", to: "2026-07-01" })).rejects.toThrow(/after/);
    await expect(run(own, "vat_report", { from: "2023-01-01", to: "2026-09-30" })).rejects.toThrow(/at most 800/);
  });

  it("is refused to a member whose role lacks the analytics area, and allowed with it", async () => {
    await expect(run(own, "vat_report", {}, { role: "admin", permissions: ["orders:read"] })).rejects.toThrow(/analytics/i);
    await expect(run(own, "oss_return_data", {}, { role: "admin", permissions: ["orders:read"] })).rejects.toThrow(/analytics/i);
    expect((await run(own, "vat_report", {}, { role: "admin", permissions: ["analytics:read"] })).made_from).toBeDefined();
  });
});

describe("oss_return_data", () => {
  it("gives the return of the worked example in euro: Part 2b for Germany and Denmark at the ECB's rate of 30 September, Part 5 52.44", async () => {
    const store = await storeOf(own);
    const view = await returnView(store, "oss", Q3, "filing");
    const answer = await run(own, "oss_return_data", { period: "2026-Q3" });
    const locale = store.markets[0].locale;
    const eur = (minor: number) => formatMoney(minor, "EUR", locale);

    expect(answer).toMatchObject({ scheme: "OSS", mode: "filing", complete: true, period: { key: "2026-Q3", from: "2026-07-01", to: "2026-09-30" } });
    expect(answer.part_2_supplies).toEqual([
      { part: expect.stringContaining("Part 2b"), member_state: "DE", member_state_of_dispatch: "SE", rate: "19 % (standard)", taxable_amount: eur(10_000), vat: eur(1_900) },
      { part: expect.stringContaining("Part 2b"), member_state: "DK", member_state_of_dispatch: "SE", rate: "25 % (standard)", taxable_amount: eur(13_377), vat: eur(3_344) },
    ]);
    expect(answer.part_5_total_to_pay).toBe(eur(5_244));
    expect(view.data.part5Eur).toBe(5_244);
    expect(answer.part_3_corrections).toEqual([]);
    expect(answer.euro_rates_used).toEqual([
      expect.objectContaining({ currency: "DKK", for_day: "2026-09-30", rate: "1 EUR = 7.4755 DKK", rate_date: "2026-09-30", source: "The European Central Bank's reference rate" }),
    ]);
    expect(answer.deadline).toContain("31 October 2026");
    expect(answer.deadline).toMatch(/Kaizen does not know what was filed|submit and pay by/);
    expect(answer.not_a_tax_return).toMatch(/not a tax return/);
    expect(answer.page).toBe(`/admin/${own.slug}/analytics/tax?view=oss&quarter=2026-Q3&mode=filing`);
  });

  it("defaults to the last completed quarter in filing mode and gives books mode in its own words", async () => {
    const answer = await run(own, "oss_return_data");
    expect(answer.period.key).toBe("2026-Q3");
    expect(answer.mode).toBe("filing");
    const books = await run(own, "oss_return_data", { mode: "books" });
    expect(books.mode_explained).toMatch(/books/i);
    expect(books.part_5_total_to_pay).toBe(answer.part_5_total_to_pay);
  });

  it("says a return with no euro rate is incomplete and which rate, and never shows the missing figures as zero", async () => {
    const answer = await run(noRate, "oss_return_data", { period: "2026-Q2" });
    expect(answer.complete).toBe(false);
    expect(answer.missing_rates).toEqual(["DKK on 30 June 2026"]);
    expect(answer.incomplete_note).toMatch(/not known and are not shown as zero/);
    expect(answer.part_2_supplies[0]).toMatchObject({ member_state: "DK", taxable_amount: { not_known: expect.any(String) }, vat: { not_known: expect.any(String) } });
    expect(answer.part_5_total_to_pay).toEqual({ not_known: expect.any(String) });
    expect(answer.euro_rates_used[0].rate).toEqual({ not_known: expect.stringContaining("DKK on 2026-06-30") });
    expect(JSON.stringify(answer.part_2_supplies)).not.toMatch(/€\s?0[,.]00|0[,.]00\s?€/);
  });

  it("is an empty return for a registered store that sold nothing, saying so", async () => {
    const answer = await run(noSales, "oss_return_data", { period: "2026-Q3" });
    expect(answer.complete).toBe(true);
    expect(answer.part_2_supplies).toEqual([]);
    expect(answer.nothing_to_report).toMatch(/no invoice or credit note/);
  });

  it("refuses a month for OSS and a quarter for IOSS, naming the form to write", async () => {
    await expect(run(own, "oss_return_data", { period: "2026-09" })).rejects.toThrow(/2026-Q3/);
    await expect(run(own, "oss_return_data", { scheme: "ioss", period: "2026-Q3" })).rejects.toThrow(/2026-09/);
  });

  it("is IOSS's month: the consignment to Sweden under the import scheme, in euro at September's rate", async () => {
    const store = await storeOf(ioss);
    const view = await returnView(store, "ioss", monthPeriod(2026, 9), "filing");
    const answer = await run(ioss, "oss_return_data", { scheme: "ioss", period: "2026-09" });
    expect(answer).toMatchObject({ scheme: "IOSS", complete: true, period: { key: "2026-09" } });
    expect(answer.part_2_supplies).toHaveLength(view.data.part2.length);
    expect(answer.part_2_supplies[0]).toMatchObject({ member_state: "SE", part: "Import scheme (IOSS)" });
    expect(answer.euro_rates_used[0]).toMatchObject({ currency: "SEK", rate: "1 EUR = 11.331 SEK" });
    expect(answer.deadline).toContain("31 October 2026");
  });

  it("says IOSS is off, and why, when the store has no IOSS number and no marked sale", async () => {
    const answer = await run(own, "oss_return_data", { scheme: "ioss", period: "2026-09" });
    expect(answer.state).toBe("off");
    expect(answer.words).toMatch(/IOSS: off/);
    expect(answer.fix_at).toBe(`/admin/${own.slug}/settings/tax`);
    expect(answer.part_2_supplies).toBeUndefined();
  });
});

describe("the attention item for OSS and IOSS data not yet exported", () => {
  const stores = () => [own, other, bare, noRate, noSales, ioss].map((f) => f.storeId);
  const at = (day: string) => new Date(`${day}T10:00:00Z`);

  it("is silent early in the month after the period and names the quarter within 14 days of its due date, in words that never say it is late", async () => {
    expect((await taxReturnsAttention(stores(), at("2026-10-04"))).get(own.storeId)).toBeUndefined();
    const found = await taxReturnsAttention(stores(), at("2026-10-20"));
    expect(found.get(own.storeId)?.map((d) => d.text)).toEqual(["Your OSS data for Q3 2026 has not been exported; it is due 31 October."]);
    expect(found.get(own.storeId)?.[0].path).toBe("/analytics/tax?view=oss&quarter=2026-Q3");
    for (const items of found.values()) for (const item of items) expect(item.text).not.toMatch(/late|overdue/i);
    // After the day it only says the day has passed.
    const after = await taxReturnsAttention(stores(), at("2026-11-03"));
    expect(after.get(own.storeId)?.[0].text).toBe("Your OSS data for Q3 2026 has not been exported; the due date, 31 October, has passed.");
  });

  it("leaves out a store with nothing to report, one with no registration, one with an intermediary's data and other stores' sales", async () => {
    const found = await taxReturnsAttention(stores(), at("2026-10-20"));
    expect(found.has(bare.storeId)).toBe(false);
    expect(found.has(noSales.storeId)).toBe(false);
    // The Danish sale of the other store is in Q2, whose due date passed more than 45 days before.
    expect(found.has(noRate.storeId)).toBe(false);
    // The IOSS store: September's data is due 31 October.
    expect(found.get(ioss.storeId)?.map((d) => d.text)).toContain("Your IOSS data for September 2026 has not been exported; it is due 31 October.");
    expect((await taxReturnsAttention([], at("2026-10-20"))).size).toBe(0);
  });

  it("goes quiet once the Return data is exported in filing mode, and a books export or the conversion detail does not count", async () => {
    const owner = await fx.ownerOf(own);
    expect(await exportReturnData(owner, "oss", Q3, "books")).toMatchObject({ ok: true });
    expect(await exportReturnData(owner, "oss", Q3, "filing", true)).toMatchObject({ ok: true });
    expect((await taxReturnsAttention([own.storeId], at("2026-10-20"))).has(own.storeId)).toBe(true);
    expect(await exportReturnData(owner, "oss", Q3, "filing")).toMatchObject({ ok: true });
    expect((await taxReturnsAttention([own.storeId], at("2026-10-20"))).has(own.storeId)).toBe(false);
  });

  it("is in the control center as an owner's item only, with the page to open", async () => {
    // The real clock is the test's: the item shows when the period's deadline is near (or just past), else the store has none.
    const owner = await fx.ownerOf(ioss);
    const center = await controlCenter(owner.account, ioss.slug);
    const figures = center.stores.find((s) => s.slug === ioss.slug)!;
    expect(figures.role).toBe("owner");
    for (const r of figures.taxReturns ?? []) {
      expect(r.path).toMatch(/^\/analytics\/tax\?view=ioss&month=\d{4}-\d{2}$/);
      expect(r.text).not.toMatch(/late|overdue/i);
    }
  });
});

describe("the reconciliation the tool repeats", () => {
  it("lists paid orders with no document by cause and says they are not in the figures", async () => {
    const waiting = await t.sellerStore("tool-tax-wait");
    await t.paidOn(waiting, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    // Not issued: invoicing is off (the fixture's default), so the order has no document.
    const answer = await run(waiting, "vat_report", { from: "2026-07-01", to: "2026-09-30" });
    expect(answer.made_from.invoices).toBe(0);
    expect(answer.paid_orders_without_a_document).toMatchObject({ count: 1, note: expect.stringContaining("not in the figures") });
    expect(answer.paid_orders_without_a_document.why[0]).toMatch(/1 /);
    expect(answer.reconciliation_with_finance.equal).toBe(true);
  });
});
