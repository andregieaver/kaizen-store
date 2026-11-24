import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { CompanyFacts, LookupAnswer } from "@/lib/company-lookup";

type Row = Record<string, unknown>;

process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));

const { recordVisit } = await import("./analytics-visits");
const { recordCompanyVisit, companyReport, pruneCompanyVisits } = await import("./company-visits");
const { forgetVisitStore } = await import("./store-facts");
const { LOOKUPS_PER_STORE_DAY, COMPANY_PAGES_KEPT } = await import("@/lib/company-lookup");

/**
 * Which companies visited (D890): a counted page view becomes its company's day, the address is asked about once a day and never kept,
 * and a sole trader, a shared network or a failure keeps nothing of a company. Leadfeeder and Brønnøysund are stand-ins here.
 */

const run = Date.now().toString(36) + randomBytes(2).toString("hex");
const slug = `companies-${run}`;
let storeId: string;
const NOW = new Date("2026-11-24T10:00:00Z");
const DAY = "2026-11-24";
const IP = "185.70.216.139";
const connection = async () => ({ provider: "leadfeeder" as const, apiKey: "test-key", accountId: "123456" });

const facts = (over: Partial<CompanyFacts> = {}): CompanyFacts => ({
  sourceId: `lf-${run}-nordfjord`,
  name: "Nordfjord Energi AS",
  legalForm: "AS",
  domain: "nordfjord-energi.no",
  countryCode: "NO",
  city: "Oslo",
  industry: "Production of electricity",
  employees: "101-500",
  registerId: "923609016",
  doNotContact: false,
  ...over,
});

/** A Leadfeeder stand-in that answers `answer` and counts its calls. */
function stand(answer: LookupAnswer) {
  const calls: string[] = [];
  return { calls, lookup: async (_c: unknown, address: string) => (calls.push(address), answer) };
}

const visit = (over: Partial<Parameters<typeof recordCompanyVisit>[0]> = {}) => ({ storeId, day: DAY, newVisitor: true, page: "/no", address: IP, now: NOW, ...over });

async function companyDays() {
  return db().execute<Row>(sql`select cv.*, c.name, c.source_id from commerce.company_visits cv join commerce.visit_companies c on c.id = cv.company_id where cv.store_id = ${storeId}::uuid order by c.name`);
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Companies test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo', visit_counting = true, company_recognition = true where id = ${storeId}::uuid`);
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.company_visits where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.company_lookups where day >= '2026-11-01' and day <= '2026-11-30'`);
  await db().execute(sql`delete from commerce.visit_companies where source_id like ${`lf-${run}-%`}`);
  await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.visits where store_id = ${storeId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

describe("a counted page view on a store that recognises companies", () => {
  it("is handed on with the store day, whether it began the visit, its page shape and the address; never while the switch is off", async () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      "x-forwarded-for": `${IP}, 10.0.0.1`,
      host: "localhost:3000",
      origin: "http://localhost:3000",
      referer: `http://localhost:3000/s/${slug}/no`,
    });
    forgetVisitStore(slug);
    const first = await recordVisit({ headers, body: { store: slug, path: `/s/${slug}/no/products` }, now: NOW });
    expect(first).toMatchObject({ recorded: true, company: { storeId, day: DAY, newVisitor: true, page: "/no/products", address: IP } });
    const second = await recordVisit({ headers, body: { store: slug, path: `/s/${slug}/no` }, now: NOW });
    expect(second).toMatchObject({ recorded: true, company: { newVisitor: false, page: "/no" } });
    await db().execute(sql`update commerce.stores set company_recognition = false where id = ${storeId}::uuid`);
    forgetVisitStore(slug);
    expect(await recordVisit({ headers, body: { store: slug, path: `/s/${slug}/no` }, now: NOW })).toEqual({ recorded: true, company: null });
    await db().execute(sql`update commerce.stores set company_recognition = true where id = ${storeId}::uuid`);
    forgetVisitStore(slug);
  });
});

describe("recordCompanyVisit", () => {
  it("keeps the company and its day, asks about an address once a day, and keeps no address", async () => {
    const lf = stand({ kind: "company", company: facts() });
    const deps = { connection, lookup: lf.lookup, norwegianSoleTrader: async () => false };
    expect(await recordCompanyVisit(visit(), deps)).toBe("company");
    expect(await recordCompanyVisit(visit({ newVisitor: false, page: "/no/pricing" }), deps)).toBe("company");
    expect(await recordCompanyVisit(visit({ newVisitor: false, page: "/no/pricing" }), deps)).toBe("company");
    expect(lf.calls).toEqual([IP]);
    const [day, ...more] = await companyDays();
    expect(more).toHaveLength(0);
    expect(day).toMatchObject({ name: "Nordfjord Energi AS", visitors: 1, page_views: 3, pages: { "/no": 1, "/no/pricing": 2 } });
    const lookups = await db().execute<Row>(sql`select * from commerce.company_lookups where day = ${DAY}::date`);
    expect(lookups).toHaveLength(1);
    expect(JSON.stringify(lookups)).not.toContain(IP);
    expect(String(lookups[0].key)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("counts a second visitor from the same company, and the company once", async () => {
    const lf = stand({ kind: "company", company: facts() });
    const deps = { connection, lookup: lf.lookup, norwegianSoleTrader: async () => false };
    await recordCompanyVisit(visit(), deps);
    await recordCompanyVisit(visit({ address: "185.70.216.140" }), deps);
    const [day] = await companyDays();
    expect(day).toMatchObject({ visitors: 2, page_views: 2 });
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.visit_companies where source_id = ${`lf-${run}-nordfjord`}`);
    expect(n).toBe(1);
  });

  it(`keeps ${COMPANY_PAGES_KEPT} pages a day and counts the rest as (other)`, async () => {
    const deps = { connection, lookup: stand({ kind: "company", company: facts() }).lookup, norwegianSoleTrader: async () => false };
    for (let i = 0; i < COMPANY_PAGES_KEPT + 3; i++) await recordCompanyVisit(visit({ newVisitor: i === 0, page: `/no/p/item-${i}` }), deps);
    const [day] = await companyDays();
    const pages = day.pages as Record<string, number>;
    expect(Object.keys(pages)).toHaveLength(COMPANY_PAGES_KEPT + 1);
    expect(pages["(other)"]).toBe(3);
    expect(day.page_views).toBe(COMPANY_PAGES_KEPT + 3);
  });

  it("never keeps a sole trader, by its legal form or by Brønnøysund", async () => {
    const byForm = { connection, lookup: stand({ kind: "company", company: facts({ sourceId: `lf-${run}-enk`, name: "Ola Nordmann", legalForm: "ENK" }) }).lookup };
    expect(await recordCompanyVisit(visit(), byForm)).toBe("none");
    const byRegister = { connection, lookup: stand({ kind: "company", company: facts({ sourceId: `lf-${run}-enk2`, name: "Kari Nordmann Design", legalForm: null }) }).lookup, norwegianSoleTrader: async () => true };
    expect(await recordCompanyVisit(visit({ address: "185.70.216.141" }), byRegister)).toBe("none");
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.visit_companies where source_id like ${`lf-${run}-enk%`}`);
    expect(n).toBe(0);
    expect(await companyDays()).toHaveLength(0);
  });

  it("keeps nothing of a shared network, and keeps a failure for the day without asking again", async () => {
    const shared = stand({ kind: "none" });
    expect(await recordCompanyVisit(visit(), { connection, lookup: shared.lookup })).toBe("none");
    expect(await recordCompanyVisit(visit(), { connection, lookup: shared.lookup })).toBe("none");
    expect(shared.calls).toHaveLength(1);
    const broken = stand({ kind: "failed", reason: "timeout" });
    expect(await recordCompanyVisit(visit({ address: "185.70.216.142" }), { connection, lookup: broken.lookup })).toBe("failed");
    expect(await recordCompanyVisit(visit({ address: "185.70.216.142" }), { connection, lookup: broken.lookup })).toBe("failed");
    expect(broken.calls).toHaveLength(1);
    expect(await companyDays()).toHaveLength(0);
  });

  it("asks nothing without a connection, for a private address, or past the store's daily bound", async () => {
    const lf = stand({ kind: "company", company: facts() });
    expect(await recordCompanyVisit(visit(), { connection: async () => null, lookup: lf.lookup })).toBe("not_connected");
    expect(await recordCompanyVisit(visit({ address: "10.1.2.3" }), { connection, lookup: lf.lookup })).toBe("no_address");
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, 'company-lookups', date_trunc('day', ${NOW.toISOString()}::timestamptz), ${LOOKUPS_PER_STORE_DAY})
    `);
    expect(await recordCompanyVisit(visit(), { connection, lookup: lf.lookup })).toBe("capped");
    expect(lf.calls).toHaveLength(0);
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.company_lookups where day = ${DAY}::date`);
    expect(n).toBe(0);
  });
});

describe("the report and the daily job", () => {
  it("reads the period's days and companies, and prunes old answers and days", async () => {
    const deps = { connection, lookup: stand({ kind: "company", company: facts() }).lookup, norwegianSoleTrader: async () => false };
    await recordCompanyVisit(visit(), deps);
    const report = await companyReport(storeId, { from: "2026-11-20", to: "2026-11-25" });
    expect(report.days).toHaveLength(1);
    expect(report.days[0]).toMatchObject({ day: DAY, visitors: 1, pageViews: 1, pages: { "/no": 1 } });
    expect(report.companies.get(report.days[0].companyId)).toMatchObject({ name: "Nordfjord Energi AS", countryCode: "NO", employees: "101-500" });
    expect((await companyReport(storeId, { from: "2026-11-25", to: "2026-11-26" })).days).toHaveLength(0);

    const pruned = await pruneCompanyVisits(new Date("2026-11-28T03:00:00Z"));
    expect(pruned.lookups).toBeGreaterThanOrEqual(1);
    expect(await companyDays()).toHaveLength(1);
    const later = await pruneCompanyVisits(new Date("2029-01-01T03:00:00Z"));
    expect(later.days).toBeGreaterThanOrEqual(1);
    expect(await companyDays()).toHaveLength(0);
  });
});
