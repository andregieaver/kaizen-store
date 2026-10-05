import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { NOT_FOUND_DAY_CAP, NOT_FOUND_IGNORED_MAX } from "@/lib/data-limits";
import { parseCsv } from "@/lib/csv";

import { auditActions, outcomeOf, redirectFixture, redirectRowsOf, type RedirectFixture } from "./redirect-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const nf = await import("./not-found");
const resolve = await import("./redirect-resolve");
const redirects = await import("./redirects");

type Row = Record<string, unknown>;

/**
 * The 404 report (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.3, 3.2, 4.5, 4.6, 6.1 R4): addresses requested and not found are counted by address and day
 * (never an IP, user agent, cookie, referrer or query string, never a working page's, a token's or a person's address), listed most requested first with the
 * robots' share, hidden or covered ones left out, each with up to three suggested targets and a one-click redirect; old rows go after 90 days.
 */

let f: RedirectFixture;
let other: RedirectFixture;

beforeAll(async () => {
  f = await redirectFixture("notfound");
  other = await redirectFixture("notfound-other");
});

afterAll(async () => {
  await closeDb();
});

const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};

/** Asks `n` times for an address, each a second apart (the throttle is one write a second per address and instance). */
async function ask(fx: RedirectFixture, path: string, n: number, crawler = false, t0 = 1_000_000): Promise<void> {
  for (let i = 0; i < n; i += 1) await nf.recordNotFound(fx.fx.storeId, path, crawler, t0 + i * 1_500);
}

const hitsOf = async (fx: RedirectFixture): Promise<Row[]> =>
  db().execute<Row>(sql`select path, hits, crawler_hits, day from commerce.not_found_hits where store_id = ${fx.fx.storeId}::uuid order by path, day`);

describe("recording", () => {
  it("counts the requests of an address, shoppers and robots, on today's UTC day", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-count");
    await ask(fx, "/collections/shoes", 3, false);
    await ask(fx, "/collections/shoes", 2, true, 2_000_000);
    const rows = await hitsOf(fx);
    expect(rows.map((r) => [r.path, r.hits, r.crawler_hits])).toEqual([["/collections/shoes", 5, 2]]);
    const [today] = await db().execute<Row>(sql`select (now() at time zone 'utc')::date::text as d`);
    expect(String(rows[0].day)).toContain(String(today.d).slice(0, 4));
    const report = (await nf.notFoundReport(fx.owner))!;
    expect(report.rows.map((r) => [r.path, r.requests, r.crawlers])).toEqual([["/collections/shoes", 5, 2]]);
    expect(report.days).toBe(30);
  });

  it("writes an address once a second at most per instance: a flood is one write", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-flood");
    for (let i = 0; i < 20; i += 1) await nf.recordNotFound(fx.fx.storeId, "/flood", false, 5_000_000 + i * 10);
    expect((await hitsOf(fx))[0].hits).toBe(1);
  });

  it("records nothing for a working page, a token, an email, an id, a probe, a long address or a query string", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-private");
    const never = ["/cart/x", "/checkout", "/order/abc", "/account/orders", "/api/x", "/admin/x", "/wp-login.php", "/.env", "/x/0123456789abcdef0123456789abcdef", "/x/123e4567-e89b-12d3-a456-426614174000", "/people/kari@example.com", "/x/12345678901234", `/${"a".repeat(201)}`, "/a/b/c/d/e/f/g/h/i", "/x?utm=1", "/x#frag", "/a b", "/"];
    for (const [i, path] of never.entries()) expect(await nf.recordNotFound(fx.fx.storeId, path, false, 9_000_000 + i * 2_000), path).toBe(false);
    expect(await hitsOf(fx)).toEqual([]);
    // An old shop's addresses are accepted.
    expect(await nf.recordNotFound(fx.fx.storeId, "/pages/om-oss.html", false, 9_100_000)).toBe(true);
    expect(await nf.recordNotFound(fx.fx.storeId, "/collections/skjorter", false, 9_100_000)).toBe(true);
  });

  it("is per store, and a failing write is logged and dropped, never thrown", async () => {
    nf.resetNotFoundThrottle();
    await ask(f, "/only-in-f", 1);
    expect((await hitsOf(other)).some((r) => r.path === "/only-in-f")).toBe(false);
    expect(await nf.recordNotFound("not-a-uuid", "/x", false)).toBe(false);
  });

  it("stops adding addresses at the day's cap and counts the rest in the day's one row without an address", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-cap");
    await db().execute(sql`select commerce.record_not_found(${fx.fx.storeId}::uuid, '/c1', false, 2)`);
    await db().execute(sql`select commerce.record_not_found(${fx.fx.storeId}::uuid, '/c2', false, 2)`);
    await db().execute(sql`select commerce.record_not_found(${fx.fx.storeId}::uuid, '/c3', true, 2)`);
    await db().execute(sql`select commerce.record_not_found(${fx.fx.storeId}::uuid, '/c3', false, 2)`);
    await db().execute(sql`select commerce.record_not_found(${fx.fx.storeId}::uuid, '/c1', false, 2)`);
    const rows = await hitsOf(fx);
    expect(rows.map((r) => [r.path, r.hits, r.crawler_hits])).toEqual([["/c1", 2, 0], ["/c2", 1, 0], [null, 2, 1]]);
    const report = (await nf.notFoundReport(fx.owner))!;
    expect(report.uncounted).toEqual({ requests: 2, days: 1 });
    expect(report.distinct).toBe(2);
    expect(NOT_FOUND_DAY_CAP).toBe(1000);
  });
});

describe("the report", () => {
  it("lists the most requested first, a tie by address, within the window of 7, 30 or 90 days", async () => {
    const fx = await redirectFixture("notfound-window");
    const id = fx.fx.storeId;
    await db().execute(sql`
      insert into commerce.not_found_hits (store_id, day, path, hits, crawler_hits) values
        (${id}::uuid, (now() at time zone 'utc')::date, '/b-new', 4, 1),
        (${id}::uuid, (now() at time zone 'utc')::date, '/a-new', 4, 0),
        (${id}::uuid, (now() at time zone 'utc')::date - 10, '/mid', 9, 0),
        (${id}::uuid, (now() at time zone 'utc')::date - 60, '/old', 20, 0),
        (${id}::uuid, (now() at time zone 'utc')::date - 6, '/week', 1, 0),
        (${id}::uuid, (now() at time zone 'utc')::date - 7, '/seven-days-old', 100, 0)
    `);
    const paths = async (days: number) => (await nf.notFoundReport(fx.owner, { days }))!.rows.map((r) => r.path);
    expect(await paths(7)).toEqual(["/a-new", "/b-new", "/week"]);
    expect(await paths(30)).toEqual(["/seven-days-old", "/mid", "/a-new", "/b-new", "/week"]);
    expect(await paths(90)).toEqual(["/seven-days-old", "/old", "/mid", "/a-new", "/b-new", "/week"]);
    // Anything else is the default window.
    expect((await nf.notFoundReport(fx.owner, { days: 12 }))!.days).toBe(30);
    // A row counts the requests of every day in the window.
    await db().execute(sql`insert into commerce.not_found_hits (store_id, day, path, hits, crawler_hits) values (${id}::uuid, (now() at time zone 'utc')::date - 1, '/a-new', 3, 2)`);
    expect((await nf.notFoundReport(fx.owner, { days: 7 }))!.rows[0]).toMatchObject({ path: "/a-new", requests: 7, crawlers: 2 });
  });

  it("limits the rows on screen and keeps the report of one store out of another's", async () => {
    const fx = await redirectFixture("notfound-limit");
    await db().execute(sql`
      insert into commerce.not_found_hits (store_id, day, path, hits) select ${fx.fx.storeId}::uuid, (now() at time zone 'utc')::date, '/gen-' || lpad(g::text, 4, '0'), 1 from generate_series(1, 30) g
    `);
    const report = (await nf.notFoundReport(fx.owner, { limit: 10 }))!;
    expect(report.rows).toHaveLength(10);
    expect(report.distinct).toBe(30);
    expect((await nf.notFoundReport(other.owner))!.rows.some((r) => r.path.startsWith("/gen-"))).toBe(false);
  });

  it("leaves out an address a redirect covers now and one staff hid, unless asked for them", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-hide");
    await ask(fx, "/fix-me", 1);
    await ask(fx, "/hide-me", 1);
    await ask(fx, "/leave-me", 1);
    ok(await nf.redirectFromReport(fx.owner, { path: "/fix-me", to: "/om-oss" }));
    ok(await nf.ignoreAddress(fx.owner, "/hide-me"));
    expect((await nf.notFoundReport(fx.owner))!.rows.map((r) => r.path)).toEqual(["/leave-me"]);
    const all = (await nf.notFoundReport(fx.owner, { showCovered: true, showIgnored: true }))!.rows;
    expect(all.map((r) => [r.path, r.covered, r.ignored]).sort()).toEqual([["/fix-me", true, false], ["/hide-me", false, true], ["/leave-me", false, false]]);
    expect(ok(await nf.restoreAddress(fx.owner, "/hide-me"))).toBeTruthy();
    expect((await nf.notFoundReport(fx.owner))!.rows.map((r) => r.path).sort()).toEqual(["/hide-me", "/leave-me"]);
  });

  it("makes the manual redirect with one click, with the origin report, and the address then answers 308", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-click");
    await ask(fx, "/pages/about-us", 2);
    const made = ok(await nf.redirectFromReport(fx.owner, { path: "/pages/about-us", to: "/om-oss" }));
    expect(made).toMatchObject({ source: "/pages/about-us", target: "/om-oss" });
    expect((await redirectRowsOf(fx.fx.storeId)).find((r) => r.source === "/pages/about-us")).toMatchObject({ kind: "manual", origin: "report" });
    expect(await outcomeOf(resolve.missOrRedirect({ store: { id: fx.fx.storeId, slug: fx.fx.slug }, market: { slug: "no", code: "NO" } }, "/pages/about-us"))).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/om-oss` });
    // The redirect's own check applies: an address that is live cannot be redirected from the report either.
    const refused = await nf.redirectFromReport(fx.owner, { path: "/om-oss", to: "/alle-produkter" });
    expect(refused).toMatchObject({ ok: false, code: "invalid" });
  });

  it("suggests live addresses found in code, never a model: the same last part first, at most three, none below the threshold", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-suggest");
    await ask(fx, `/products/${fx.product.handle}`, 1);
    await ask(fx, `/collections/${fx.category.slug}`, 1);
    await ask(fx, "/pages/om-oss.html", 1);
    await ask(fx, "/products/something-nobody-has-here", 1);
    const report = (await nf.notFoundReport(fx.owner))!;
    const by = new Map(report.rows.map((r) => [r.path, r.suggestions]));
    expect(by.get(`/products/${fx.product.handle}`)?.[0]).toMatchObject({ path: `/p/${fx.product.handle}`, kind: "product" });
    expect(by.get(`/collections/${fx.category.slug}`)?.[0]).toMatchObject({ path: `/category/${fx.category.slug}`, kind: "category" });
    expect(by.get("/pages/om-oss.html")?.[0]).toMatchObject({ path: "/om-oss", kind: "page" });
    expect(by.get("/products/something-nobody-has-here")).toEqual([]);
    for (const suggestions of by.values()) expect(suggestions.length).toBeLessThanOrEqual(3);
    // A suggestion makes a redirect that the redirect service accepts.
    const first = by.get(`/products/${fx.product.handle}`)![0];
    ok(await nf.redirectFromReport(fx.owner, { path: `/products/${fx.product.handle}`, to: first.path }));
  });

  it("hides at most 1,000 addresses, with the limit named", async () => {
    const fx = await redirectFixture("notfound-ignore-limit");
    await db().execute(sql`insert into commerce.not_found_ignored (store_id, path) select ${fx.fx.storeId}::uuid, '/hidden-' || g from generate_series(1, ${NOT_FOUND_IGNORED_MAX}) g`);
    const refused = await nf.ignoreAddress(fx.owner, "/one-more");
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { problems: string[] }).problems[0]).toContain("1,000");
    // An address that is already hidden is fine.
    expect(await nf.ignoreAddress(fx.owner, "/hidden-1")).toEqual({ ok: true });
  });

  it("is the CSV of the report as shown, through the one writer, with the two headings of counts", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-csv");
    await ask(fx, "/csv-a", 2);
    await ask(fx, "/csv-b", 1, true);
    const file = (await nf.notFoundCsv(fx.owner))!;
    expect(file.filename).toMatch(/^404-report-30-days-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(parseCsv(file.csv).rows).toEqual([
      ["address", "requests", "of_which_robots", "last_asked", "redirect"],
      ["/csv-a", "2", "0", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), "no"],
      ["/csv-b", "1", "1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), "no"],
    ]);
  });
});

describe("who may do what", () => {
  it("lets the website's reader see the report and nothing else, and shows nothing to a member without the key", async () => {
    nf.resetNotFoundThrottle();
    const fx = await redirectFixture("notfound-keys");
    await ask(fx, "/keys", 1);
    expect((await nf.notFoundReport(fx.reader))!.rows).toHaveLength(1);
    expect((await nf.notFoundCsv(fx.reader))!.rows).toBe(1);
    expect(await nf.notFoundReport(fx.outsider)).toBeNull();
    expect(await nf.notFoundCsv(fx.outsider)).toBeNull();
    expect(await nf.ignoreAddress(fx.reader, "/keys")).toMatchObject({ ok: false });
    expect(await nf.restoreAddress(fx.reader, "/keys")).toMatchObject({ ok: false });
    expect(await nf.redirectFromReport(fx.reader, { path: "/keys", to: "/om-oss" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await nf.redirectFromReport(fx.outsider, { path: "/keys", to: "/om-oss" })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("writes an entry when an address is hidden or brought back, naming the address and nothing else", async () => {
    const fx = await redirectFixture("notfound-audit");
    ok(await nf.ignoreAddress(fx.owner, "/audit-me"));
    ok(await nf.restoreAddress(fx.owner, "/audit-me"));
    expect((await auditActions(fx.fx.storeId, "not_found.")).map((e) => [e.action, e.details, e.area])).toEqual([
      ["not_found.ignored", { path: "/audit-me" }, "website"],
      ["not_found.restored", { path: "/audit-me" }, "website"],
    ]);
  });
});

describe("retention", () => {
  it("removes the report's rows 90 days after their day, keeps the rest, the hidden addresses and the redirects, and never throws", async () => {
    const fx = await redirectFixture("notfound-prune");
    const id = fx.fx.storeId;
    await db().execute(sql`
      insert into commerce.not_found_hits (store_id, day, path, hits) values
        (${id}::uuid, (now() at time zone 'utc')::date - 91, '/gone', 1), (${id}::uuid, (now() at time zone 'utc')::date - 90, '/kept-90', 1),
        (${id}::uuid, (now() at time zone 'utc')::date - 400, null, 7), (${id}::uuid, (now() at time zone 'utc')::date, '/today', 1)
    `);
    ok(await nf.ignoreAddress(fx.owner, "/gone"));
    ok(await redirects.createRedirect(fx.owner, { from: "/gone", to: "/om-oss" }));
    expect(await nf.pruneNotFound(2)).toBeGreaterThanOrEqual(2);
    expect((await hitsOf(fx)).map((r) => r.path)).toEqual(["/kept-90", "/today"]);
    expect((await db().execute<Row>(sql`select 1 from commerce.not_found_ignored where store_id = ${id}::uuid`)).length).toBe(1);
    expect((await redirectRowsOf(id)).length).toBeGreaterThan(0);
  });
});
