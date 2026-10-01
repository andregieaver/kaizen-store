import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { consentCookieName, encodeConsent } from "@/lib/cookie-consent";
import { assignAll } from "@/lib/experiment-assign";
import { dataCookieName, decodeAssignments, encodeAssignments } from "@/lib/experiments";
import { newPageContent, type PageContent } from "@/lib/page-content";
import { newBlock, newRow } from "@/lib/page-rows";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/** One browser's cookies, kept between calls as a real browser would. */
const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const admin = await import("./experiment-admin");
const results = await import("./experiment-results");
const jobs = await import("./experiment-jobs");
const engine = await import("./experiments");
const emails = await import("./experiment-emails");
const stores = await import("./stores");
const pages = await import("./pages");

const run = Date.now().toString(36);
let storeId: string;
let store: NonNullable<Awaited<ReturnType<typeof stores.getOpenStore>>>;
let account: Account;
let aboutId: string;
let counter = 0;

const uuid = () => randomUUID();
/** The store's first market: the currency its tests are measured in. */
const home = () => ({ code: store.markets[0].code, currency: store.markets[0].nativeCurrency, locale: store.markets[0].locale });
let orderNumber = 0;

/** A browser that has (or has not) accepted statistics, and holds the answers for the store's running tests. */
function browser(opts: { statistics: boolean; versions?: Record<string, string>; visitor?: string }) {
  jar.clear();
  if (opts.statistics) jar.set(consentCookieName(storeId), encodeConsent({ visitor: uuid(), version: "statistics", choices: { preferences: false, statistics: true, marketing: false } }));
  if (opts.versions) jar.set(dataCookieName(storeId), encodeAssignments({ visitor: opts.visitor ?? uuid(), versions: opts.versions }));
}

/** A visitor id that the draw gives this version of this test. */
async function visitorFor(testId: string, version: string): Promise<string> {
  const running = await engine.runningExperiments(storeId);
  for (let i = 0; i < 500; i += 1) {
    const visitor = uuid();
    const { assignments } = assignAll(
      running.map((t) => ({ id: t.id, trafficShare: t.trafficShare, audience: t.audience, variants: t.variants.map((v) => ({ key: v.key, share: v.share })) })),
      null,
      { market: "no", device: "desktop", returning: false },
      () => visitor,
    );
    if (assignments.versions[testId] === version) return visitor;
  }
  throw new Error("No visitor found.");
}

async function cart(): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, ${home().code}, ${home().currency}, ${home().locale}, now() + interval '1 day') returning id
  `);
  return String(row.id);
}

async function paidOrder(cartId: string, over: { total?: number; tax?: number; status?: string; copied?: boolean; currency?: string } = {}) {
  orderNumber += 1;
  await db().transaction(async (tx) => {
    if (over.copied) await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
    await tx.execute(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, cart_id, subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from)
      values (${storeId}::uuid, ${`${over.copied ? "C-" : ""}ab-${run}-${orderNumber}`}, ${home().code}, ${over.currency ?? home().currency}, ${home().locale}, ${`ab-${orderNumber}@example.com`}, ${over.status ?? "paid"}, ${cartId}::uuid,
        ${over.total ?? 10000}, 0, ${over.tax ?? 2000}, ${over.total ?? 10000}, '{}', '{}', ${over.copied ? uuid() : null}::uuid)
    `);
  });
}

/** The version's published content with a different main heading, so it differs from the original. */
async function changeVariant(testId: string, key: string) {
  const test = (await admin.getExperiment(storeId, testId))!;
  const pageId = test.variants.find((v) => v.key === key)!.pageId!;
  const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${pageId}::uuid`);
  const content = row.published as PageContent;
  const rows = content.rows.map((r) => ({
    ...r,
    columns: r.columns.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === "heading" ? { ...b, text: `${b.text} (new)` } : b)) })),
  }));
  const next = JSON.stringify({ ...content, rows });
  await db().execute(sql`update commerce.pages set draft = ${next}::jsonb, published = ${next}::jsonb where id = ${pageId}::uuid`);
}

/** A running test of the about page with the given goal, ready for visitors. */
async function runningTest(goal = "orders", goalBlock: string | null = null, pageId = aboutId): Promise<string> {
  const made = await admin.createExperiment(account, storeId, { name: `Test ${(counter += 1)}`, pageId, goal, goalBlock, hypothesis: "A longer story sells more" });
  if (!made.ok) throw new Error(made.problems.join(" "));
  await changeVariant(made.id, "b");
  const started = await admin.startExperiment(account, storeId, made.id);
  if (!started.ok) throw new Error(started.problems.join(" "));
  return made.id;
}

async function endAll() {
  for (const t of await admin.listExperiments(storeId)) {
    if (t.status === "running") await admin.stopExperiment(account, storeId, t.id);
  }
  engine.forgetRunning(storeId);
}

beforeAll(async () => {
  // The jobs look at every store's running tests: leave none from earlier runs of this suite.
  await db().execute(sql`update commerce.experiments set status = 'stopped' where status = 'running'`);
  const [req] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`ab-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(req.id)}::uuid, ${`ab-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  const [slug] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const found = await stores.getOpenStore(String(slug.slug));
  if (!found) throw new Error("The test store is not open.");
  store = found;
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`ab-admin-${run}@example.com`}, 'AB Admin') returning id`);
  account = { id: String(acc.id), email: `ab-admin-${run}@example.com`, name: "AB Admin", platformAdmin: false };
  const [about] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${storeId}::uuid and type = 'page' and slug = 'om-oss'`);
  aboutId = String(about.id);
});

beforeEach(async () => {
  await endAll();
  jar.clear();
});

afterAll(async () => {
  await closeDb();
});

describe("making a test (D148)", () => {
  it("offers the pages that can be tested, and makes a draft with the original and a copy to change", async () => {
    const offered = await admin.testablePages(storeId);
    expect(offered.map((p) => p.slug)).toContain("om-oss");
    // The front page and the All products page have addresses of their own kind.
    expect(offered.map((p) => p.slug)).not.toContain("forside");
    expect(offered.map((p) => p.slug)).not.toContain("alle-produkter");

    const made = await admin.createExperiment(account, storeId, { name: "Longer story", pageId: aboutId, goal: "orders" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const test = (await admin.getExperiment(storeId, made.id))!;
    expect(test).toMatchObject({ status: "draft", goal: "orders", trafficShare: 1, minDays: 14 });
    expect(test.variants.map((v) => [v.key, v.share, v.pageId === null])).toEqual([["a", 0.5, true], ["b", 0.5, false]]);
    // The copy is a page made for the test: no address on the site, and not in the page list.
    const copy = test.variants.find((v) => v.key === "b")!;
    const [row] = await db().execute<Row>(sql`select type, slug, published_at is not null as live from commerce.pages where id = ${copy.pageId}::uuid`);
    expect(row).toMatchObject({ type: "variant", slug: engine.variantSlug(made.id, "b"), live: true });
    expect(await pages.findPublishedPage(storeId, engine.variantSlug(made.id, "b"))).toBeNull();
    expect((await pages.listPublishedPages(storeId)).map((p) => p.slug)).not.toContain(engine.variantSlug(made.id, "b"));
    expect(copy.changed).toBe(false);
    expect((await admin.deleteDraft(account, storeId, made.id)).ok).toBe(true);
    const gone = await db().execute<Row>(sql`select 1 from commerce.pages where id = ${copy.pageId}::uuid`);
    expect(gone).toHaveLength(0);
  });

  it("says what is wrong in words, and refuses to start a copy that is still the original", async () => {
    expect(await admin.createExperiment(account, storeId, { name: " ", pageId: aboutId, goal: "orders" })).toMatchObject({ ok: false });
    expect(await admin.createExperiment(account, storeId, { name: "x", pageId: aboutId, goal: "sales" })).toMatchObject({ ok: false, problems: ["Choose what the test should improve."] });
    expect(await admin.createExperiment(account, storeId, { name: "x", pageId: aboutId, goal: "click" })).toMatchObject({ ok: false });
    expect(await admin.createExperiment(account, storeId, { name: "x", pageId: aboutId, goal: "click", goalBlock: "nope" })).toMatchObject({ ok: false, problems: ["That button is not on the page."] });
    expect(await admin.createExperiment(account, storeId, { name: "x", pageId: uuid(), goal: "orders" })).toMatchObject({ ok: false });
    const made = await admin.createExperiment(account, storeId, { name: "Same", pageId: aboutId, goal: "orders" });
    if (!made.ok) throw new Error("not made");
    const refused = await admin.startExperiment(account, storeId, made.id);
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.problems.join(" ")).toMatch(/Version B is still the same as the original/);
    await changeVariant(made.id, "b");
    expect((await admin.startExperiment(account, storeId, made.id)).ok).toBe(true);
    // A test that has started cannot be changed, only renamed.
    expect(await admin.updateDraft(account, storeId, made.id, { goal: "cart" })).toMatchObject({ ok: false });
    expect(await admin.renameExperiment(account, storeId, made.id, { name: "Renamed" })).toEqual({ ok: true });
    expect(await admin.addVariant(account, storeId, made.id)).toMatchObject({ ok: false });
    expect(await admin.deleteDraft(account, storeId, made.id)).toMatchObject({ ok: false });
  });

  it("adds and removes versions with the shares evened out", async () => {
    const made = await admin.createExperiment(account, storeId, { name: "Three", pageId: aboutId, goal: "cart" });
    if (!made.ok) throw new Error("not made");
    expect((await admin.addVariant(account, storeId, made.id))).toEqual({ ok: true, key: "c" });
    let test = (await admin.getExperiment(storeId, made.id))!;
    expect(test.variants.map((v) => v.key)).toEqual(["a", "b", "c"]);
    expect(test.variants.reduce((s, v) => s + v.share, 0)).toBeCloseTo(1, 3);
    expect(await admin.removeVariant(account, storeId, made.id, "a")).toMatchObject({ ok: false });
    expect(await admin.removeVariant(account, storeId, made.id, "c")).toEqual({ ok: true });
    test = (await admin.getExperiment(storeId, made.id))!;
    expect(test.variants.map((v) => [v.key, v.share])).toEqual([["a", 0.5], ["b", 0.5]]);
    expect(await admin.removeVariant(account, storeId, made.id, "b")).toMatchObject({ ok: false });
    await admin.deleteDraft(account, storeId, made.id);
  });
});

describe("who is counted (D148)", () => {
  it("records a visitor's first sight of the version they hold, once, only with consent and only for what the cookie says", async () => {
    const id = await runningTest();
    const visitor = await visitorFor(id, "b");
    // Without having accepted statistics: nothing is recorded, whatever the cookie says.
    browser({ statistics: false, versions: { [id]: "b" }, visitor });
    expect(await engine.recordExposure(storeId, id, "b", { market: "no", device: "mobile" })).toBe(false);
    browser({ statistics: true, versions: { [id]: "b" }, visitor });
    // A claim the cookie does not make (another version, another test, outside the test) is refused.
    expect(await engine.recordExposure(storeId, id, "a", { market: "no", device: "mobile" })).toBe(false);
    expect(await engine.recordExposure(storeId, uuid(), "b", { market: "no", device: "mobile" })).toBe(false);
    browser({ statistics: true, versions: { [id]: "0" }, visitor });
    expect(await engine.recordExposure(storeId, id, "0", { market: "no", device: "mobile" })).toBe(false);
    browser({ statistics: true });
    expect(await engine.recordExposure(storeId, id, "b", { market: "no", device: "mobile" })).toBe(false);
    // The visitor's own: once.
    browser({ statistics: true, versions: { [id]: "b" }, visitor });
    expect(await engine.recordExposure(storeId, id, "b", { market: "no", device: "mobile" })).toBe(true);
    expect(await engine.recordExposure(storeId, id, "b", { market: "no", device: "mobile" })).toBe(false);
    const rows = await db().execute<Row>(sql`select variant, market, device from commerce.experiment_exposures where experiment_id = ${id}::uuid`);
    expect(rows).toEqual([{ variant: "b", market: "no", device: "mobile" }]);
    // Nothing identifies the person: the visitor is the browser's random id for this store.
    const [stored] = await db().execute<Row>(sql`select visitor from commerce.experiment_exposures where experiment_id = ${id}::uuid`);
    expect(String(stored.visitor)).toBe(visitor);
  });

  it("stops recording the moment the test stops, and for a test that is not the store's", async () => {
    const id = await runningTest();
    const visitor = await visitorFor(id, "a");
    browser({ statistics: true, versions: { [id]: "a" }, visitor });
    await admin.stopExperiment(account, storeId, id);
    expect(await engine.recordExposure(storeId, id, "a", { market: "no", device: "desktop" })).toBe(false);
    expect(await engine.runningExperiments(storeId)).toEqual([]);
  });

  it("serves the store's running tests to the proxy and the page from a short memory, forgotten when a test changes", async () => {
    expect(await engine.runningExperiments(storeId)).toEqual([]);
    const id = await runningTest();
    const running = await engine.runningExperiments(storeId);
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ id, slug: "om-oss", goal: "orders", trafficShare: 1 });
    expect(running[0].variants.map((v) => v.key)).toEqual(["a", "b"]);
    expect(await engine.storeIdOfSlug(store.slug)).toBe(storeId);
    expect(await engine.storeIdOfSlug("no-such-store")).toBeNull();
  });
});

describe("what a test finds (D148)", () => {
  it("counts carts, checkouts and paid orders of the visitors who were shown each version, and what they paid without VAT", async () => {
    const id = await runningTest("orders");
    const visitorA = await visitorFor(id, "a");
    const visitorB = await visitorFor(id, "b");
    const visitorB2 = await visitorFor(id, "b");

    // Version A's visitor looks and leaves.
    browser({ statistics: true, versions: { [id]: "a" }, visitor: visitorA });
    expect(await engine.recordExposure(storeId, id, "a", { market: "no", device: "desktop" })).toBe(true);
    // Version B's first visitor adds to the cart, starts checkout and pays 100 kr with 20 kr VAT.
    browser({ statistics: true, versions: { [id]: "b" }, visitor: visitorB });
    expect(await engine.recordExposure(storeId, id, "b", { market: "no", device: "mobile" })).toBe(true);
    const cartB = await cart();
    await engine.recordExperimentCart(storeId, cartB, "cart");
    await engine.recordExperimentCart(storeId, cartB, "checkout");
    await paidOrder(cartB, { total: 10000, tax: 2000 });
    // Version B's second visitor adds to the cart, but their order is cancelled, so it is not counted.
    browser({ statistics: true, versions: { [id]: "b" }, visitor: visitorB2 });
    expect(await engine.recordExposure(storeId, id, "b", { market: "no", device: "desktop" })).toBe(true);
    const cartB2 = await cart();
    await engine.recordExperimentCart(storeId, cartB2, "cart");
    await paidOrder(cartB2, { status: "cancelled" });

    const test = (await admin.getExperiment(storeId, id))!;
    const r = await results.experimentResults(store, test);
    expect(r.funnel.a).toEqual({ visitors: 1, carts: 0, checkouts: 0, buyers: 0, clicks: 0 });
    expect(r.funnel.b).toEqual({ visitors: 2, carts: 2, checkouts: 1, buyers: 1, clicks: 0 });
    expect(r.revenue.b.plain).toBe(8000);
    expect(r.currency).toBe(home().currency);
    expect(r.unconverted).toBe(0);
    expect(r.figures.find((f) => f.key === "b")).toMatchObject({ visitors: 2, conversions: 1 });
    expect(r.splitP).toBeGreaterThan(0.1);
    // Far too few visitors to say anything: the words say so, with what to wait for.
    expect(r.verdict.kind).toBe("few");
    expect(r.verdict.headline).toBe("Too early to say.");
    expect(r.days).toBe(0);
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0].variants.b).toEqual({ visitors: 2, conversions: 1 });
    expect(r.weekly[0]).toMatchObject({ week: 1 });
  });

  it("does not count an order placed before the visitor saw the version, or after the test stopped", async () => {
    const id = await runningTest("orders");
    const visitor = await visitorFor(id, "b");
    browser({ statistics: true, versions: { [id]: "b" }, visitor });
    const early = await cart();
    await engine.recordExperimentCart(storeId, early, "cart");
    await paidOrder(early);
    await db().execute(sql`update commerce.orders set placed_at = now() - interval '1 day' where cart_id = ${early}::uuid`);
    await engine.recordExposure(storeId, id, "b", { market: "no", device: "desktop" });
    const late = await cart();
    await engine.recordExperimentCart(storeId, late, "cart");
    await admin.stopExperiment(account, storeId, id);
    await paidOrder(late);
    await db().execute(sql`update commerce.orders set placed_at = now() + interval '1 hour' where cart_id = ${late}::uuid`);
    const r = await results.experimentResults(store, (await admin.getExperiment(storeId, id))!);
    expect(r.funnel.b.buyers).toBe(0);
  });

  it("counts a click on the chosen button, once, from an exposed visitor only", async () => {
    // A page with a button to count.
    const content = newPageContent();
    const row = newRow("1", () => `r-${uuid().slice(0, 8)}`);
    const button = newBlock("button", () => `btn-${uuid().slice(0, 8)}`);
    if (button.type !== "button") throw new Error("not a button");
    button.label = "Buy now";
    button.href = "/products";
    const heading = newBlock("heading", () => `h-${uuid().slice(0, 8)}`);
    if (heading.type !== "heading") throw new Error("not a heading");
    heading.text = "Kampanje";
    heading.level = 1;
    row.columns[0].blocks.push(heading, button);
    const page: PageContent = { ...content, title: "Kampanje", slug: "kampanje", rows: [row] };
    const saved = await pages.savePage(account, storeId, null, page, { publish: true });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    const id = await runningTest("click", button.id, saved.id);
    const visitor = await visitorFor(id, "b");
    browser({ statistics: true, versions: { [id]: "b" }, visitor });
    // Not exposed yet: no click is recorded.
    expect(await engine.recordClick(storeId, id, button.id)).toBe(false);
    await engine.recordExposure(storeId, id, "b", { market: "no", device: "desktop" });
    // Another block than the test's is refused; the test's own counts once.
    expect(await engine.recordClick(storeId, id, "btn-other")).toBe(false);
    expect(await engine.recordClick(storeId, id, button.id)).toBe(true);
    expect(await engine.recordClick(storeId, id, button.id)).toBe(false);
    const r = await results.experimentResults(store, (await admin.getExperiment(storeId, id))!);
    expect(r.funnel.b.clicks).toBe(1);
    expect(r.figures.find((f) => f.key === "b")).toMatchObject({ visitors: 1, conversions: 1 });
    expect(admin.buttonsOf(page)).toEqual([{ id: button.id, label: "Buy now" }]);
  });
});

describe("ending a test (D148)", () => {
  it("stops it, then makes a version the page without moving its address, ending the test as applied", async () => {
    const id = await runningTest();
    expect(await admin.applyVariant(account, storeId, id, "b")).toMatchObject({ ok: false, problems: ["Stop the test before choosing a winner."] });
    expect((await admin.stopExperiment(account, storeId, id)).ok).toBe(true);
    expect(await admin.stopExperiment(account, storeId, id)).toMatchObject({ ok: false });
    expect(await admin.applyVariant(account, storeId, id, "a")).toMatchObject({ ok: false });
    const before = await pages.findPublishedPage(storeId, "om-oss");
    const headingOf = (found: typeof before) => (found && "page" in found ? JSON.stringify(found.page.content.rows) : "");
    const rowsBefore = headingOf(before);
    const applied = await admin.applyVariant(account, storeId, id, "b");
    expect(applied).toEqual({ ok: true });
    const after = await pages.findPublishedPage(storeId, "om-oss");
    expect(headingOf(after)).toContain("(new)");
    expect(rowsBefore).not.toContain("(new)");
    expect(after && "page" in after ? after.page.slug : "").toBe("om-oss");
    expect((await admin.getExperiment(storeId, id))!).toMatchObject({ status: "applied", appliedVariant: "b" });
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action in ('experiment.started', 'experiment.stopped', 'experiment.applied')`);
    expect(Number(audited.n)).toBeGreaterThanOrEqual(3);
    // The test is history: it cannot be deleted or restarted.
    expect(await admin.deleteDraft(account, storeId, id)).toMatchObject({ ok: false });
  });

  it("says which running test holds a page, as the original or as a version, until it stops", async () => {
    const id = await runningTest();
    const test = (await admin.getExperiment(storeId, id))!;
    expect(await admin.runningTestOf(storeId, aboutId)).toMatchObject({ id });
    expect(await admin.runningTestOf(storeId, test.variants.find((v) => v.key === "b")!.pageId!)).toMatchObject({ id });
    expect(await admin.runningTestOf(storeId, uuid())).toBeNull();
    await admin.stopExperiment(account, storeId, id);
    expect(await admin.runningTestOf(storeId, aboutId)).toBeNull();
  });

  it("keeps the original: discarding a stopped test", async () => {
    const id = await runningTest();
    await admin.stopExperiment(account, storeId, id);
    expect((await admin.discardExperiment(account, storeId, id)).ok).toBe(true);
    expect((await admin.getExperiment(storeId, id))!.status).toBe("discarded");
    expect(await admin.discardExperiment(account, storeId, id)).toMatchObject({ ok: false });
  });

  it("stops a test a week after its planned end, and one a version clearly harms, by itself", async () => {
    const late = await runningTest();
    await db().execute(sql`update commerce.experiments set planned_end = now() - interval '8 days', started_at = now() - interval '30 days' where id = ${late}::uuid`);
    const stopped = await jobs.runExperimentJobs(new Date());
    expect(stopped.stopped).toBe(1);
    expect(await admin.getExperiment(storeId, late)).toMatchObject({ status: "stopped", stopReason: "planned_end" });

    // 5,000 visitors in each version: 250 ordered in the original, 130 in B.
    const id = await runningTest();
    await db().execute(sql`
      insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant)
      select ${storeId}::uuid, ${id}::uuid, 'visitor-' || v.variant || '-' || n, v.variant from (values ('a'::text), ('b'::text)) v(variant), generate_series(1, 5000) n
    `);
    for (const [variant, buyers] of [["a", 250], ["b", 130]] as const) {
      const cartOf = sql`md5(${`${run}-${id}-${variant}-`} || n)::uuid`;
      await db().execute(sql`
        insert into commerce.carts (id, store_id, market_code, currency, locale, expires_at)
        select ${cartOf}, ${storeId}::uuid, ${home().code}, ${home().currency}, ${home().locale}, now() + interval '1 day' from generate_series(1, ${buyers}::int) n
      `);
      await db().execute(sql`
        insert into commerce.experiment_carts (store_id, cart_id, visitor)
        select ${storeId}::uuid, ${cartOf}, ${`visitor-${variant}-`} || n from generate_series(1, ${buyers}::int) n
      `);
      await db().execute(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, cart_id, subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
        select ${storeId}::uuid, ${`g-${run}-${variant}-`} || n, ${home().code}, ${home().currency}, ${home().locale}, 'g@example.com', 'paid', ${cartOf}, 10000, 0, 2000, 10000, '{}', '{}' from generate_series(1, ${buyers}::int) n
      `);
    }
    // Fresh bulk inserts have no statistics yet: give the planner some, as a store with history would have.
    for (const table of ["experiment_exposures", "experiment_carts", "orders", "carts"]) await db().execute(sql.raw(`analyze commerce.${table}`));
    const r = await results.experimentResults(store, (await admin.getExperiment(storeId, id))!);
    expect(r.funnel.a.buyers).toBe(250);
    expect(r.funnel.b.buyers).toBe(130);
    expect(r.harmed).toBe("b");
    // The hourly check (the first minutes of the hour) stops it.
    const hour = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 120_000);
    const guarded = await jobs.runExperimentJobs(hour);
    expect(guarded.stopped).toBe(1);
    expect(await admin.getExperiment(storeId, id)).toMatchObject({ status: "stopped", stopReason: "guardrail" });

    // The owner is told, once, with the figures counted above (phase 6); the planned-end stop earlier sent nothing.
    const mails = await db().execute<Row>(sql`select to_address, subject, text, status from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'experiment.guardrail'`);
    expect(mails).toHaveLength(1);
    expect(mails[0].to_address).toBe(`ab-${run}@example.com`);
    expect(String(mails[0].subject)).toContain("fewer orders in version B");
    expect(String(mails[0].text)).toContain("130 of 5,000 visitors who saw version B ordered (2.6 %), against 250 of 5,000 who saw the original (5 %)");
    expect(String(mails[0].text)).toContain(`/admin/${store.slug}/experiments/${id}`);
    // Asking again, as a second run of the check would, sends nothing more.
    const again = await emails.notifyGuardrailStop(store, (await admin.getExperiment(storeId, id))!, r);
    expect(again).toEqual(["duplicate"]);
  }, 60_000);

  it("emails the store's owners and the person who made the test, but not other staff or anyone disabled", async () => {
    const id = await runningTest();
    const test = (await admin.getExperiment(storeId, id))!;
    const other = async (name: string) => {
      const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`ab-${name}-${run}@example.com`}, ${name}) returning id`);
      return String(row.id);
    };
    const [staff, gone] = [await other("staff"), await other("gone")];
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}::uuid, ${account.id}::uuid, 'admin'), (${storeId}::uuid, ${staff}::uuid, 'admin')`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role, disabled_at) values (${storeId}::uuid, ${gone}::uuid, 'admin', now())`);
    // The figures only need to say a version is harmed: the email is made from them.
    const harmed = {
      harmed: "b",
      days: 5,
      funnel: { a: { visitors: 2000, carts: 0, checkouts: 0, buyers: 100, clicks: 0 }, b: { visitors: 2000, carts: 0, checkouts: 0, buyers: 40, clicks: 0 } },
    } satisfies Parameters<typeof emails.notifyGuardrailStop>[2];
    const outcomes = await emails.notifyGuardrailStop(store, test, harmed);
    expect(outcomes).toHaveLength(2);
    const sent = await db().execute<Row>(sql`select to_address from commerce.email_messages where idempotency_key like ${`experiment.guardrail:${id}:%`} order by to_address`);
    expect(sent.map((r) => r.to_address)).toEqual([`ab-admin-${run}@example.com`, `ab-${run}@example.com`].sort());
    await db().execute(sql`delete from commerce.store_members where store_id = ${storeId}::uuid and account_id in (${account.id}::uuid, ${staff}::uuid, ${gone}::uuid)`);
  });

  it("does not email anyone for a stop by a person or at the planned end, or when no version is harmed", async () => {
    const id = await runningTest();
    const test = (await admin.getExperiment(storeId, id))!;
    const none = await results.experimentResults(store, test);
    expect(await emails.notifyGuardrailStop(store, test, none)).toEqual([]);
    expect(await db().execute<Row>(sql`select 1 from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'experiment.guardrail' and idempotency_key like ${`experiment.guardrail:${id}:%`}`)).toHaveLength(0);
  });

  it("recovers the visitors' cookie values the way the browser reads them", () => {
    const value = encodeAssignments({ visitor: "11111111-1111-4111-8111-111111111111", versions: { "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": "b" } });
    expect(decodeAssignments(value)?.versions).toEqual({ "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": "b" });
  });
});

/** The published content of the about page and of a version, for the part tests. */
async function publishedOf(pageId: string): Promise<PageContent> {
  const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${pageId}::uuid`);
  return row.published as PageContent;
}

async function editVersion(testId: string, key: string, change: (content: PageContent) => PageContent) {
  const test = (await admin.getExperiment(storeId, testId))!;
  const pageId = test.variants.find((v) => v.key === key)!.pageId!;
  const next = JSON.stringify(change(await publishedOf(pageId)));
  await db().execute(sql`update commerce.pages set draft = ${next}::jsonb, published = ${next}::jsonb where id = ${pageId}::uuid`);
}

const withBlock = (content: PageContent, id: string, change: (b: Record<string, unknown>) => Record<string, unknown>): PageContent => ({
  ...content,
  rows: content.rows.map((r) => ({ ...r, columns: r.columns.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? (change(b as never) as never) : b)) })) })),
});

describe("tests of a part of a page (D148, phase 2)", () => {
  it("makes a test of one block, accepts a version that changes only it, and applies only that part to the page as it is then", async () => {
    const made = await admin.createExperiment(account, storeId, { name: "Heading only", pageId: aboutId, goal: "cart", part: { kind: "block", id: "heading-about" } });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const draft = (await admin.getExperiment(storeId, made.id))!;
    expect(draft.part).toMatchObject({ id: "heading-about", kind: "block" });
    expect(draft.part!.label).toMatch(/^Heading “/);
    expect(draft.variants.find((v) => v.key === "b")!.scope).toBe("ok");
    // Unchanged: nothing to find.
    expect(await admin.startExperiment(account, storeId, made.id)).toMatchObject({ ok: false, problems: [expect.stringMatching(/still the same/)] });
    // Changing something outside the part is refused, in words.
    await editVersion(made.id, "b", (c) => withBlock(c, "text-about", (b) => ({ ...b, htmlId: "changed" })));
    expect((await admin.getExperiment(storeId, made.id))!.variants.find((v) => v.key === "b")!.scope).toBe("outside");
    const refused = await admin.startExperiment(account, storeId, made.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.problems.join(" ")).toMatch(/changes more than Heading/);
    // Only the part: it starts.
    await editVersion(made.id, "b", (c) => withBlock(withBlock(c, "text-about", (b) => ({ ...b, htmlId: undefined })), "heading-about", (b) => ({ ...b, text: "A part-only winner" })));
    expect(await admin.startExperiment(account, storeId, made.id)).toEqual({ ok: true });
    expect(await admin.stopExperiment(account, storeId, made.id)).toEqual({ ok: true });
    // After the stop the page was edited elsewhere: the winner brings its part and keeps that edit.
    await db().execute(sql`
      update commerce.pages set published = jsonb_set(published, '{rows,0,columns,0,blocks,1,htmlId}', '"edited-after"'), draft = jsonb_set(draft, '{rows,0,columns,0,blocks,1,htmlId}', '"edited-after"') where id = ${aboutId}::uuid
    `);
    expect(await admin.applyVariant(account, storeId, made.id, "b")).toEqual({ ok: true });
    const after = await publishedOf(aboutId);
    const block = (id: string) => after.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).find((b) => b.id === id) as unknown as Record<string, unknown>;
    expect(block("heading-about").text).toBe("A part-only winner");
    expect(block("text-about").htmlId).toBe("edited-after");
    expect(after.slug).toBe("om-oss");
    const [audited] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'experiment.applied' order by created_at desc limit 1`);
    expect(JSON.stringify(audited.details)).toContain("heading-about");
    // Tidy: the next tests start from a page with no leftover id.
    await db().execute(sql`
      update commerce.pages set published = published #- '{rows,0,columns,0,blocks,1,htmlId}', draft = draft #- '{rows,0,columns,0,blocks,1,htmlId}' where id = ${aboutId}::uuid
    `);
  });

  it("refuses a part the published page does not have, a click goal on a button outside the part, and a version that lost the part", async () => {
    expect(await admin.createExperiment(account, storeId, { name: "x", pageId: aboutId, goal: "orders", part: { kind: "block", id: "nope" } })).toMatchObject({ ok: false });
    expect(await admin.createExperiment(account, storeId, { name: "x", pageId: aboutId, goal: "orders", part: { kind: "row", id: "heading-about" } })).toMatchObject({ ok: false });
    expect(await admin.createExperiment(account, storeId, { name: "x", pageId: aboutId, goal: "click", goalBlock: "heading-about", part: { kind: "block", id: "heading-about" } })).toMatchObject({
      ok: false,
      problems: ["That button is not in the part you are testing."],
    });
    const made = await admin.createExperiment(account, storeId, { name: "Row", pageId: aboutId, goal: "orders", part: { kind: "row", id: "row-about" } });
    if (!made.ok) throw new Error(made.problems.join(" "));
    await editVersion(made.id, "b", (c) => ({ ...c, rows: [] }));
    expect((await admin.getExperiment(storeId, made.id))!.variants.find((v) => v.key === "b")!.scope).toBe("missing");
    await admin.deleteDraft(account, storeId, made.id);
  });
});

describe("a test that starts at a time (D148, phase 2)", () => {
  it("is scheduled in the future, can move or go back to a draft, and starts by itself when its time has come", async () => {
    const made = await admin.createExperiment(account, storeId, { name: "Later", pageId: aboutId, goal: "orders" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    await changeVariant(made.id, "b");
    const soon = new Date(Date.now() + 3_600_000);
    expect(await admin.scheduleExperiment(account, storeId, made.id, new Date(Date.now() - 1000))).toMatchObject({ ok: false, problems: ["Choose a time in the future."] });
    expect(await admin.scheduleExperiment(account, storeId, made.id, new Date(Date.now() + 200 * 86_400_000))).toMatchObject({ ok: false });
    expect(await admin.scheduleExperiment(account, storeId, made.id, soon)).toEqual({ ok: true });
    expect(await admin.getExperiment(storeId, made.id)).toMatchObject({ status: "scheduled", scheduledStart: soon.toISOString() });
    // Not running yet: nobody is served it, and its page is still free to edit.
    expect((await engine.runningExperiments(storeId)).some((t) => t.id === made.id)).toBe(false);
    expect(await admin.runningTestOf(storeId, aboutId)).toBeNull();
    // Another time, then back to a draft with a reason, then scheduled again.
    const later = new Date(Date.now() + 2 * 3_600_000);
    expect(await admin.scheduleExperiment(account, storeId, made.id, later)).toEqual({ ok: true });
    expect(await admin.unscheduleExperiment(account, storeId, made.id)).toEqual({ ok: true });
    expect((await admin.getExperiment(storeId, made.id))!.status).toBe("draft");
    expect(await admin.scheduleExperiment(account, storeId, made.id, soon)).toEqual({ ok: true });
    // Before its time the job leaves it; after, it starts.
    expect((await jobs.runExperimentJobs(new Date())).started).toBe(0);
    const result = await jobs.runExperimentJobs(new Date(soon.getTime() + 60_000));
    expect(result.started).toBe(1);
    engine.forgetRunning(storeId);
    expect(await admin.getExperiment(storeId, made.id)).toMatchObject({ status: "running", scheduleProblem: null });
    expect((await engine.runningExperiments(storeId)).some((t) => t.id === made.id)).toBe(true);
    await admin.stopExperiment(account, storeId, made.id);
  });

  it("goes back to a draft with the reason when it can no longer start", async () => {
    const made = await admin.createExperiment(account, storeId, { name: "Too late", pageId: aboutId, goal: "orders" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    await changeVariant(made.id, "b");
    const at = new Date(Date.now() + 3_600_000);
    expect(await admin.scheduleExperiment(account, storeId, made.id, at)).toEqual({ ok: true });
    // The version is put back as the original while it waits.
    const original = await publishedOf(aboutId);
    await editVersion(made.id, "b", () => original);
    const result = await jobs.runExperimentJobs(new Date(at.getTime() + 60_000));
    expect(result.started).toBe(0);
    const test = (await admin.getExperiment(storeId, made.id))!;
    expect(test.status).toBe("draft");
    expect(test.scheduleProblem).toMatch(/scheduled start did not happen.*still the same as the original/);
    await admin.deleteDraft(account, storeId, made.id);
  });
});

const layoutsMod = await import("./site-layouts");
const productLayouts = await import("./product-layouts");
const abSite = await import("@/lib/ab-site");

/** A published page of this type in the store, with the about page's content under a heading of its own, used as the header, footer or product layout. */
async function chromePage(type: "header" | "footer" | "product_layout", heading: string): Promise<string> {
  const content = await publishedOf(aboutId);
  const text = JSON.stringify({ ...content, title: `Test ${type}`, slug: `ab-${type.replace("_", "-")}-${run}`, rows: withBlock(content, "heading-about", (b) => ({ ...b, text: heading })).rows });
  const [row] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${storeId}::uuid, ${`ab-${type.replace("_", "-")}-${run}`}, ${type}, ${text}::jsonb, ${text}::jsonb, now()) returning id
  `);
  return String(row.id);
}

describe("tests of the header, the footer and the product layout (D148, phase 3)", () => {
  it("lists them as things to test only where they are used, and makes a test whose version stands in for the header", async () => {
    const header = await chromePage("header", "Header A");
    const footer = await chromePage("footer", "Footer A");
    const before = (await admin.testablePages(storeId)).filter((t) => t.kind !== "page");
    expect(before.some((t) => t.id === header || t.id === footer)).toBe(false);
    await db().execute(sql`update commerce.stores set header_id = ${header}::uuid, footer_id = ${footer}::uuid where id = ${storeId}::uuid`);
    const after = await admin.testablePages(storeId);
    expect(after.find((t) => t.id === header)).toMatchObject({ kind: "header" });
    expect(after.find((t) => t.id === footer)).toMatchObject({ kind: "footer" });

    const made = await admin.createExperiment(account, storeId, { name: "Header", pageId: header, goal: "cart" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const test = (await admin.getExperiment(storeId, made.id))!;
    expect(test.page).toMatchObject({ type: "header", kind: "header" });
    expect(await admin.testOfVersionPage(storeId, test.variants[1].pageId!)).toMatchObject({ targetType: "header", key: "b" });
    // The version is a copy to change; unchanged, it cannot start.
    expect(await admin.startExperiment(account, storeId, made.id)).toMatchObject({ ok: false });
    await editVersion(made.id, "b", (c) => withBlock(c, "heading-about", (b) => ({ ...b, text: "Header B" })));
    expect(await admin.startExperiment(account, storeId, made.id)).toEqual({ ok: true });
    engine.forgetRunning(storeId);

    // The running test is read by the pages that draw the header, and its version stands in for the header for a visitor in it.
    const token = abSite.testToken(made.id);
    const [site] = await engine.siteTests(storeId);
    expect(site).toMatchObject({ id: made.id, token, kind: "header", targetPageId: header });
    const headingOf = (layout: { content: PageContent } | null) => JSON.stringify(layout?.content.rows ?? []);
    const original = await layoutsMod.siteLayoutForVisitor(storeId, "header", {});
    expect(original).toMatchObject({ version: "a", test: { id: made.id } });
    expect(headingOf(original.layout)).toContain("Header A");
    const mine = await layoutsMod.siteLayoutForVisitor(storeId, "header", { [token]: "b" });
    expect(mine.version).toBe("b");
    expect(headingOf(mine.layout)).toContain("Header B");
    expect(mine.layout?.id).not.toBe(header);
    // A version that does not exist, or the original, shows the original; the footer is not the test's.
    expect((await layoutsMod.siteLayoutForVisitor(storeId, "header", { [token]: "d" })).version).toBe("a");
    expect((await layoutsMod.siteLayoutForVisitor(storeId, "header", { [token]: "a" })).version).toBe("a");
    const foot = await layoutsMod.siteLayoutForVisitor(storeId, "footer", { [token]: "b" });
    expect(foot).toMatchObject({ test: null, version: "a" });
    expect(headingOf(foot.layout)).toContain("Footer A");

    // The proxy sees it as a test of every page.
    const [running] = (await engine.runningExperiments(storeId)).filter((t) => t.id === made.id);
    expect(running.kind).toBe("header");

    // After it stops the header is the header again, and a winner becomes it, keeping its place.
    expect(await admin.stopExperiment(account, storeId, made.id)).toEqual({ ok: true });
    expect(await engine.siteTests(storeId)).toEqual([]);
    expect(headingOf((await layoutsMod.siteLayoutForVisitor(storeId, "header", { [token]: "b" })).layout)).toContain("Header A");
    expect(await admin.applyVariant(account, storeId, made.id, "b")).toEqual({ ok: true });
    expect(headingOf(await layoutsMod.siteLayoutFor(storeId, "header"))).toContain("Header B");
    expect((await layoutsMod.siteLayoutChoice(storeId)).header).toBe(header);
    await db().execute(sql`update commerce.stores set header_id = null, footer_id = null where id = ${storeId}::uuid`);
  });

  it("serves the product layout's version to a visitor in it, on the products that use the layout", async () => {
    const layout = await chromePage("product_layout", "Layout A");
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and status = 'active' limit 1`);
    const productId = String(product.id);
    expect((await admin.testablePages(storeId)).some((t) => t.id === layout)).toBe(false);
    await db().execute(sql`update commerce.products set product_layout_id = ${layout}::uuid where id = ${productId}::uuid`);
    expect((await admin.testablePages(storeId)).find((t) => t.id === layout)).toMatchObject({ kind: "layout" });

    const made = await admin.createExperiment(account, storeId, { name: "Layout", pageId: layout, goal: "orders" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    await editVersion(made.id, "b", (c) => withBlock(c, "heading-about", (b) => ({ ...b, text: "Layout B" })));
    expect(await admin.startExperiment(account, storeId, made.id)).toEqual({ ok: true });
    const token = abSite.testToken(made.id);
    const text = (drawn: { content: PageContent } | null) => JSON.stringify(drawn?.content.rows ?? []);

    const own = await productLayouts.productLayoutForVisitor(storeId, productId, {});
    expect(own).toMatchObject({ version: "a", test: { id: made.id } });
    expect(text(own)).toContain("Layout A");
    const mine = await productLayouts.productLayoutForVisitor(storeId, productId, { [token]: "b" });
    expect(mine?.version).toBe("b");
    expect(text(mine)).toContain("Layout B");
    // A product on another layout, or on the built-in one, is not part of the test.
    const [other] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and id <> ${productId}::uuid limit 1`);
    const elsewhere = await productLayouts.productLayoutForVisitor(storeId, String(other.id), { [token]: "b" });
    expect(elsewhere?.test ?? null).toBeNull();

    // A visitor's exposure to a test of a layout or header counts like any other, from the cookie's own answer.
    const visitor = await visitorFor(made.id, "b");
    browser({ statistics: true, versions: { [made.id]: "b" }, visitor });
    await engine.recordExposure(storeId, made.id, "b", { market: "no", device: "desktop" });
    const r = await results.experimentResults(store, (await admin.getExperiment(storeId, made.id))!);
    expect(r.figures.find((f) => f.key === "b")).toMatchObject({ visitors: 1 });

    await admin.stopExperiment(account, storeId, made.id);
    await db().execute(sql`update commerce.products set product_layout_id = null where id = ${productId}::uuid`);
  });
});
