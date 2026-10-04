import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/**
 * The platform's VAT administration (D157): categories, rates with history, verification, the coverage of reduced rates and the
 * shipping rule per country. Platform admins only; every change audit-logged. The seeded rates are shared reference data
 * and are never changed here: the rates these tests set are on categories of their own.
 */

vi.mock("server-only", () => ({}));
const refreshed = vi.hoisted(() => ({ tags: [] as string[] }));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: (tag: string) => void refreshed.tags.push(tag),
  revalidateTag: (tag: string) => void refreshed.tags.push(tag),
}));

const admin = await import("./vat-admin");
const { listVatCategories, ratesNow } = await import("./vat-categories");

const run = Date.now().toString(36);
const code = `a${run}`.slice(0, 20);
let platform: Account;
let outsider: Account;

const auditOf = (action: string, key: string) =>
  db().execute<Row>(sql`select details, account_id from commerce.audit_log where action = ${action} and details::text like ${`%${key}%`} order by created_at`);

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`vat-admin-${run}@example.com`}, 'Admin', true) returning id`);
  const [b] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`vat-owner-${run}@example.com`}, 'Owner') returning id`);
  platform = { id: String(a.id), email: `vat-admin-${run}@example.com`, name: "Admin", platformAdmin: true };
  outsider = { id: String(b.id), email: `vat-owner-${run}@example.com`, name: "Owner", platformAdmin: false };
});

afterAll(async () => {
  await closeDb();
});

describe("who may change VAT", () => {
  it("is a platform admin only, for every function", async () => {
    const no = { ok: false, problems: ["Only a platform admin can change VAT."] };
    expect(await admin.addVatCategory(outsider, { code, nameEn: "Test", description: "", sort: 1 })).toEqual(no);
    expect(await admin.setVatCategoryActive(outsider, "food", false)).toEqual(no);
    expect(await admin.setVatRate(outsider, { country: "NO", category: "food", ratePercent: 15, validFrom: "2030-01-01", source: "https://example.org/x", checkedOn: "2026-10-03" })).toEqual(no);
    expect(await admin.verifyVatRate(outsider, { country: "NO", category: "food", validFrom: "2026-01-01" })).toEqual(no);
    expect(await admin.setShippingVatRule(outsider, { country: "NO", rule: "standard" })).toEqual(no);
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.vat_categories where code = ${code}`);
    expect(Number(n)).toBe(0);
  });
});

describe("categories", () => {
  it("adds one, audit-logged, and refuses a repeated or malformed code", async () => {
    const added = await admin.addVatCategory(platform, { code, nameEn: "Test goods", description: "For the tests.", sort: 900 });
    expect(added).toMatchObject({ ok: true, category: { code, nameEn: "Test goods", active: true, builtIn: false } });
    const [entry] = await auditOf("vat.category_added", code);
    expect(entry.account_id).toBe(platform.id);
    expect(await admin.addVatCategory(platform, { code, nameEn: "Again" })).toEqual({ ok: false, problems: [`There is already a category with the code "${code}".`] });
    expect(await admin.addVatCategory(platform, { code: "Food!", nameEn: "x" })).toMatchObject({ ok: false });
    expect(await admin.addVatCategory(platform, { code: "ok_code", nameEn: "" })).toMatchObject({ ok: false, problems: ["Give the category a name."] });
    expect(await admin.addVatCategory(platform, { code: "ok_code", nameEn: "x".repeat(61) })).toMatchObject({ ok: false });
    expect((await listVatCategories()).find((c) => c.code === code)).toMatchObject({ nameEn: "Test goods", sort: 900 });
  });

  it("switches one off and on, and never a built-in one", async () => {
    expect(await admin.setVatCategoryActive(platform, code, false)).toEqual({ ok: true });
    expect((await listVatCategories()).find((c) => c.code === code)?.active).toBe(false);
    expect(await admin.setVatCategoryActive(platform, code, true)).toEqual({ ok: true });
    for (const builtIn of ["standard", "exempt", "accommodation"]) {
      expect(await admin.setVatCategoryActive(platform, builtIn, false)).toMatchObject({ ok: false, problems: [expect.stringContaining("built-in")] });
    }
    expect(await admin.setVatCategoryActive(platform, "nonexistent", false)).toEqual({ ok: false, problems: ["There is no such category."] });
    expect((await auditOf("vat.category_active", code)).length).toBe(2);
  });

  it("is never deleted, round the application either", async () => {
    await expect(db().execute(sql`delete from commerce.vat_categories where code = ${code}`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/vat_category_kept/) } });
  });
});

describe("rates with history", () => {
  const base = { country: "NO", ratePercent: 10, validFrom: "2026-01-01", source: "Kaizen test data, not a rate", checkedOn: "2026-10-03", note: "" };

  it("sets a first rate, and the next one ends the old period and begins a new, never an edit in place", async () => {
    expect(await admin.setVatRate(platform, { ...base, category: code })).toEqual({ ok: true });
    expect(await admin.setVatRate(platform, { ...base, category: code, ratePercent: 12.5, validFrom: "2030-07-01" })).toEqual({ ok: true });
    const rows = await admin.listVatRates({ country: "NO", category: code });
    expect(rows.map((r) => [r.validFrom, r.validTo, r.rate, r.state])).toEqual([
      ["2030-07-01", null, 0.125, "scheduled"],
      ["2026-01-01", "2030-07-01", 0.1, "current"],
    ]);
    // The rate in force today is the first; the second is only scheduled.
    expect((await ratesNow()).NO[code]).toEqual({ rate: 0.1, hasRow: true });
    // Both are audit-logged by the function, with the previous rate.
    const entries = await auditOf("vat.rate_set", code);
    expect(entries.map((e) => (e.details as { rate: number }).rate)).toEqual([0.1, 0.125]);
    expect((entries[1].details as { previous_rate: number }).previous_rate).toBe(0.1);
    expect(refreshed.tags).toContain("catalog");
    // A row cannot be edited or deleted round the application.
    await expect(db().execute(sql`update commerce.vat_rates set rate = 0.5 where category = ${code}`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/vat_rate_history/) } });
    await expect(db().execute(sql`delete from commerce.vat_rates where category = ${code}`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/vat_rate_history/) } });
  });

  it("refuses a date that is not after the latest period, a rate for exempt goods, an unknown place or category, and a bad rate", async () => {
    expect(await admin.setVatRate(platform, { ...base, category: code, validFrom: "2028-01-01" })).toMatchObject({ ok: false, problems: [expect.stringContaining("must start after the latest")] });
    expect(await admin.setVatRate(platform, { ...base, category: "exempt" })).toMatchObject({ ok: false, problems: [expect.stringContaining("exempt")] });
    expect(await admin.setVatRate(platform, { ...base, category: code, country: "ZZ", validFrom: "2031-01-01" })).toMatchObject({ ok: false, problems: [expect.stringContaining("unknown country")] });
    expect(await admin.setVatRate(platform, { ...base, category: "no_such_category", validFrom: "2031-01-01" })).toMatchObject({ ok: false, problems: [expect.stringContaining("unknown category")] });
    expect(await admin.setVatRate(platform, { ...base, category: code, ratePercent: 100, validFrom: "2031-01-01" })).toMatchObject({ ok: false });
    expect(await admin.setVatRate(platform, { ...base, category: code, ratePercent: 12.3456, validFrom: "2031-01-01" })).toEqual({ ok: false, problems: ["Use at most three decimals."] });
    expect(await admin.setVatRate(platform, { ...base, category: code, source: "short", validFrom: "2031-01-01" })).toMatchObject({ ok: false });
    expect(await admin.setVatRate(platform, { ...base, category: code, validFrom: "01.01.2031" })).toMatchObject({ ok: false, problems: ["Use a date as year-month-day."] });
  });

  it("starts unverified, is verified once by a named person, and the unverified list follows", async () => {
    expect((await admin.unverifiedRates()).some((r) => r.category === code && r.validFrom === "2026-01-01")).toBe(true);
    expect(await admin.verifyVatRate(platform, { country: "NO", category: code, validFrom: "2026-01-01" })).toEqual({ ok: true });
    const [verified] = (await admin.listVatRates({ country: "NO", category: code })).filter((r) => r.validFrom === "2026-01-01");
    expect(verified.verified).toMatchObject({ by: "Admin" });
    expect((await admin.unverifiedRates()).some((r) => r.category === code && r.validFrom === "2026-01-01")).toBe(false);
    expect(await admin.verifyVatRate(platform, { country: "NO", category: code, validFrom: "2026-01-01" })).toMatchObject({ ok: false, problems: [expect.stringContaining("already verified")] });
    expect((await auditOf("vat.rate_verified", code)).length).toBe(1);
  });

  it("shows coverage: the rate where a country has one, the standard rate by fallback where it has not", async () => {
    const { categories, countries } = await admin.vatCoverage();
    expect(categories.map((c) => c.code)).toEqual(expect.arrayContaining(["standard", "exempt", "accommodation", "food", "books", code]));
    const norway = countries.find((c) => c.code === "NO")!;
    expect(norway.cells[code]).toMatchObject({ rate: 0.1, hasRow: true, fallback: false, text: "10 %", verified: true });
    expect(norway.cells.exempt).toMatchObject({ rate: 0, text: "no VAT", verified: true });
    // A country with no row for the category is on the standard rate, and says so.
    const malta = countries.find((c) => c.code === "MT")!;
    expect(malta.cells[code]).toMatchObject({ hasRow: false, fallback: true, text: expect.stringContaining("no reduced rate known here") });
    expect(malta.cells[code].rate).toBe(malta.cells.standard.rate);
    // Countries a store sells to come first.
    const inUse = countries.filter((c) => c.inUse).length;
    expect(countries.slice(0, inUse).every((c) => c.inUse)).toBe(true);
  });

  it("is what the product editor and the order flow read: a missing row is the standard rate", async () => {
    const [row] = await db().execute<Row>(sql`select commerce.vat_rate('NO', ${code}) as now, commerce.vat_rate('MT', ${code}) as other, commerce.vat_rate('NO', ${code}, timestamptz '2031-01-01 12:00+00') as later`);
    expect({ now: Number(row.now), later: Number(row.later) }).toEqual({ now: 0.1, later: 0.125 });
    expect(Number(row.other)).toBe(Number((await ratesNow()).MT.standard.rate));
  });
});

describe("shipping VAT rules", () => {
  const country = "MT";

  it("keeps a rule that was not verified as a draft that never applies, and a verified one needs its source and date", async () => {
    expect(await admin.setShippingVatRule(platform, { country, rule: "highest", source: "", checkedOn: null, note: "to look into", verified: false })).toEqual({ ok: true });
    let [row] = (await admin.listShippingVatRules()).filter((r) => r.country === country);
    expect(row).toMatchObject({ rule: "highest", verified: false, applied: "standard" });
    expect(await admin.setShippingVatRule(platform, { country, rule: "highest", source: "", checkedOn: null, verified: true })).toMatchObject({ ok: false, problems: [expect.stringContaining("source")] });
    expect(await admin.setShippingVatRule(platform, { country, rule: "follows_goods", source: "https://example.org/act (test data)", checkedOn: "2026-10-03", note: "", verified: true })).toEqual({ ok: true });
    [row] = (await admin.listShippingVatRules()).filter((r) => r.country === country);
    expect(row).toMatchObject({ rule: "follows_goods", verified: true, applied: "follows_goods", checkedOn: "2026-10-03" });
    // Any change replaces the verification.
    await admin.setShippingVatRule(platform, { country, rule: "highest", source: "https://example.org/act (test data)", checkedOn: "2026-10-03", verified: false });
    [row] = (await admin.listShippingVatRules()).filter((r) => r.country === country);
    expect(row).toMatchObject({ rule: "highest", verified: false, applied: "standard" });
    expect((await auditOf("vat.shipping_rule_set", `"country": "${country}"`)).length).toBeGreaterThanOrEqual(3);
    // Left as it was found.
    await admin.setShippingVatRule(platform, { country, rule: "standard", source: "", checkedOn: null, verified: false });
  });

  it("refuses a rule that is not one, and an unknown country", async () => {
    expect(await admin.setShippingVatRule(platform, { country, rule: "free", source: "" })).toMatchObject({ ok: false, problems: [expect.stringContaining("rule")] });
    expect(await admin.setShippingVatRule(platform, { country: "ZZ", rule: "standard" })).toMatchObject({ ok: false, problems: [expect.stringContaining("unknown country")] });
  });
});

describe("the daily job", () => {
  it("brings the countries' cached standard rate up to the rate in force, and says how many changed", async () => {
    const result = await admin.syncStandardRates();
    expect(result.changed).toBeGreaterThanOrEqual(0);
    // Nothing differs after it: the cache is what `commerce.vat_rate(country, 'standard')` says.
    const [off] = await db().execute<Row>(sql`select count(*)::int as n from commerce.countries where standard_vat_rate is distinct from commerce.vat_rate(code, 'standard')`);
    expect(Number(off.n)).toBe(0);
    expect(await admin.syncStandardRates()).toMatchObject({ changed: 0 });
  });

  it("refreshes the catalogue when a rate of any category began lately, so a scheduled reduced rate does not leave its label on the old rate", async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const category = `r_${run}`.slice(0, 20);
    expect(await admin.addVatCategory(platform, { code: category, nameEn: `Scheduled ${run}`, description: "test", sort: 90 })).toMatchObject({ ok: true });
    const base = { country: "NO", category, ratePercent: 8, source: "https://example.org/rate (test data)", checkedOn: "2026-10-03" };
    // A rate that began some days ago: nothing lately.
    expect(await admin.setVatRate(platform, { ...base, validFrom: day(-10) })).toEqual({ ok: true });
    refreshed.tags.length = 0;
    const before = await admin.syncStandardRates();
    // A change that takes effect today (the country's date may differ from UTC's by a day: the window is two days).
    expect(await admin.setVatRate(platform, { ...base, ratePercent: 9, validFrom: day(0) })).toEqual({ ok: true });
    refreshed.tags.length = 0;
    const after = await admin.syncStandardRates();
    expect(after.recent).toBeGreaterThan(before.recent);
    expect(after.changed).toBe(0);
    expect(refreshed.tags).toContain("catalog");
  });
});
