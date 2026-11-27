import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { StatementRecord } from "@/db/statement-count";

/**
 * The query budget (bloat review step 1.10, DQ-11): the statements and the rows Postgres read of the dispatcher's idle jobs one by one,
 * of each minute route, of the daily routes and of a cold page frame, held in the key `queryBudget` of `src/server/ratchet.baseline.json`.
 * A figure above its baseline fails with the job's name and the statements it sent most; one below asks for the baseline to be lowered.
 *
 * Run on a freshly seeded database (node scripts/db-setup.mjs --seed): CI runs it before the other integration files. On a database it
 * ran on before, a few jobs read more rows or send other statements (the status checks keep their own history, the legal sources and the
 * cookie scan were due once, the daily run did its first catch-up): seed again rather than lower the baseline.
 *
 * It counts twice: with the database as the seed made it ("one", the demo store and Kaizena Flow's), and with 20 stores more that have
 * every per-store feature on (`budget-seed-test-support.ts`, removed afterwards), and holds what the 20 stores add ("growth").
 *
 * Each figure is the second run of the work: the first warms what is kept per process and lets a job do its catch-up. The clock is
 * fixed at `idleClock()` (a Wednesday at 10:23 UTC), so no job is at its hour, and no job reaches the network: `fetch` answers with an
 * error, and the jobs that try are named in REACHES_NETWORK. The routes' work after the answer (`after()`) is run and counted with them.
 */

const { pending, network } = vi.hoisted(() => ({
  pending: [] as (() => unknown)[],
  /** The network, refused: each call is written down under the work that made it. */
  network: { current: "", reached: new Map<string, Set<string>>() },
}));
vi.mock("server-only", () => ({}));
// The fetch that reads other websites (legal sources, pages to copy, sites to crawl) goes through node:https, not `fetch`.
vi.mock("./replicate-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./replicate-fetch")>()),
  safeFetch: async (url: string) => {
    if (!network.reached.has(network.current)) network.reached.set(network.current, new Set());
    network.reached.get(network.current)!.add(new URL(url).host);
    return { ok: false as const, problem: "query budget: no network" };
  },
}));
// No browser here: the due cookie scan finds nothing and ends done, since a scan that fails counts as a failed run of the job and would
// add the failing job's alert and incident to the figures (incident 74c699bf, ci-red #72). Its own statements are the same either way.
vi.mock("@/lib/cookie-scan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cookie-scan")>()),
  scanWithin: async () => ({ pages: [], items: [] }),
}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({
  connection: async () => {},
  after: (task: (() => unknown) | Promise<unknown>) => void pending.push(typeof task === "function" ? task : () => task),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
process.env.CRON_SECRET = "query-budget";
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const support = await import("./query-budget-test-support");
type QueryBudget = import("./query-budget-test-support").QueryBudget;
const { closeDb } = await import("@/db/client");
const { kebab } = await import("./cron-runs");
const { DISPATCHER_JOBS } = await import("./dispatcher-jobs");
const { getStore, getOpenStore } = await import("./stores");
const { resolveShop } = await import("./shop");
const { afterSaleOpenCached } = await import("./after-sale");
const { siteLayoutFor, siteLayoutForVisitor } = await import("./site-layouts");
const { legalLinksFor } = await import("./legal-links");
const { textStylesCssFor } = await import("./text-styles");
const { getPlatformChrome } = await import("./platform-navigation");
const { siteStoreCached } = await import("./site-store");
const { siteCookies } = await import("./site-cookies");
const { liveCustomCode } = await import("@/lib/custom-code");
const { featureOn } = await import("@/lib/store-features");
const { db } = await import("@/db/client");
const { sql } = await import("drizzle-orm");
const { listPublishedPages } = await import("./pages");
const { runLedgerPosting } = await import("./ledger");
const { SEEDED_FEATURES, seedStores, removeSeed } = await import("./budget-seed-test-support");

type Figures = { statements: number; rowsRead: number };

const MINUTE_ROUTES = ["autopilot", "broadcasts", "cookie-scan", "dream-factory", "integrations", "pack-pictures", "page-jobs", "page-looks", "theme-shots"] as const;
const DAILY_ROUTES = ["subscription-reminders", "usage"] as const;
const WRITE = process.env.UPDATE_BASELINE === "1";
const RAISE = process.env.FIRST === "1";
const FIX = "UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/query-budget.int.test.ts";

/**
 * The work that tries the network when there is nothing to do (each call answered with an error, which the work logs and gets past). Only
 * shrinks: a name that stops trying fails until it is taken off, and a new one fails.
 */
const REACHES_NETWORK: readonly string[] = [
  // The status page's checks (D360) ask the site's own address for its pages, whatever is due.
  "dispatcher.status",
  // The daily run stores the ECB's latest euro reference rates for the OSS and IOSS returns (D161), once a day.
  "route.subscription-reminders",
  // The official legal texts (D311): on a fresh database every source is due, so each run tries a few (EUR-Lex, Lovdata, and the rest).
  "dispatcher.legal-sources",
  // With 20 stores: their chat agents' knowledge cut from the 30 published pages each has, with vectors asked of the store's own AI (D81).
  "dispatcher.knowledge",
];

/**
 * Work whose rows read follow the database's own clock (`now()` in SQL, which the fixed clock of this file cannot reach): only its
 * statements are compared, its rows read are written down. The VAT labels' check reads the countries' rates differently in the minutes
 * around a country's midnight (29 rows at 21:59 UTC, 257 at 22:00). Only shrinks.
 */
const CLOCK_ROWS: readonly string[] = ["dispatcher.vat-labels"];
/**
 * Work whose rows read with 20 stores differ by a few between runs on fresh databases however the tables are vacuumed (its runners read
 * with a limit rows that other jobs wrote side by side, so where a scan stops moves): with 20 stores only its statements are compared.
 * route.broadcasts read 7,229 to 7,258 rows in nine runs. Only shrinks.
 */
const UNSTEADY_TWENTY_ROWS: readonly string[] = ["route.broadcasts"];
const keysOf = (name: string, group: Group | "growth" = "one") =>
  CLOCK_ROWS.includes(name) || (group !== "one" && UNSTEADY_TWENTY_ROWS.includes(name)) ? (["statements"] as const) : (["statements", "rowsRead"] as const);

const ROUTES = Object.fromEntries(
  await Promise.all(
    [...MINUTE_ROUTES, ...DAILY_ROUTES].map(async (name) => [name, ((await import(`../app/api/cron/${name}/route.ts`)) as { POST: (r: Request) => Promise<Response> }).POST]),
  ),
) as Record<string, (r: Request) => Promise<Response>>;

const realFetch = globalThis.fetch;
const originals: (() => unknown)[] = [];
const reached = network.reached;

/** The figures this run measured, by group, and their records, by name. */
type Group = "one" | "twenty";
const measured: Record<Group, Record<string, Figures>> = { one: {}, twenty: {} };
const records: Record<string, StatementRecord[]> = {};

beforeAll(async () => {
  const clock = support.idleClock();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!reached.has(network.current)) reached.set(network.current, new Set());
    reached.get(network.current)!.add(url.host);
    throw new Error(`query budget: ${network.current} tried the network (${url.host})`);
  }) as typeof fetch;
  // And the SDKs that call out through node:http and node:https themselves; the database is a socket of its own, never one of these.
  for (const mod of [http, https] as unknown as Record<string, (...args: unknown[]) => unknown>[]) {
    for (const fn of ["request", "get"]) {
      const original = mod[fn];
      originals.push(() => (mod[fn] = original));
      mod[fn] = (...args: unknown[]) => {
        const first = args[0] as string | URL | { hostname?: string; host?: string };
        const host = typeof first === "string" || first instanceof URL ? new URL(first).host : (first.hostname ?? first.host ?? "");
        if (!reached.has(network.current)) reached.set(network.current, new Set());
        reached.get(network.current)!.add(host);
        throw new Error(`query budget: ${network.current} tried the network (${host})`);
      };
    }
  }
  syncBuiltinESMExports();
  // Vacuumed and analysed first, so the planner's statistics and the visibility map are as they will stay, and autovacuum kept away until
  // the file ends: coming by in the middle of a run it turned an index scan into an index-only one, or analysed a table a job had just
  // filled (the knowledge base's passages read 39,700 rows or 78,893), and the rows read changed with when it came.
  for (const { tablename } of await support.side()`select tablename from pg_tables where schemaname = 'commerce'`) {
    await support.side().unsafe(`alter table commerce."${String(tablename)}" set (autovacuum_enabled = false)`);
  }
  await support.side()`vacuum analyze`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const restore of originals) restore();
  syncBuiltinESMExports();
  vi.useRealTimers();
  try {
    if (WRITE) write();
  } finally {
    await closeDb();
    for (const { tablename } of await support.side()`select tablename from pg_tables where schemaname = 'commerce'`) {
      await support.side().unsafe(`alter table commerce."${String(tablename)}" reset (autovacuum_enabled)`);
    }
    await support.closeSide();
  }
});

/** Runs the work of an answered request: what the route left for after its answer. */
async function drain(): Promise<void> {
  while (pending.length > 0) await pending.shift()!();
}

async function callRoute(name: string): Promise<Response> {
  const response = await ROUTES[name](
    new Request(`http://localhost/api/cron/${name}`, { method: "POST", headers: { authorization: "Bearer query-budget" }, body: "{}" }),
  );
  await drain();
  return response;
}

/** Runs `work` once to warm it, then measures a second run; a run that throws fails with the work's name. */
async function count(group: Group, name: string, work: () => Promise<unknown>): Promise<Figures> {
  network.current = name;
  try {
    await work();
  } catch (error) {
    throw new Error(`${name} threw on its first run: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  let result: Awaited<ReturnType<typeof support.measure>>;
  try {
    result = await support.measure(work);
  } catch (error) {
    throw new Error(`${name} threw on its second run: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const figures = { statements: result.statements, rowsRead: result.rowsRead };
  measured[group][name] = figures;
  records[`${group}:${name}`] = result.records;
  return figures;
}

/**
 * The room a figure has over its baseline: none for statements (a statement more is a real change), a tenth (at least 50) for rows read,
 * which move with the planner and Postgres's version (reviewed 17 November 2026: CI runs Postgres 17, the baseline was measured on 16).
 */
const roomOf = (key: keyof Figures, held: number): number => (key === "rowsRead" ? Math.max(50, Math.round(held * 0.1)) : 0);

/**
 * A figure above the baseline fails with both numbers and what was sent most. One below is a note: lower the baseline when it suits
 * (a fall never fails, so the other work's improvements do not hold back a release).
 */
function compare(group: Group, name: string, now: Figures): void {
  // With UPDATE_BASELINE=1 the figures are written in afterAll, which refuses a rise without FIRST=1.
  if (WRITE) return;
  const held = support.readBaseline()[group]?.[name];
  if (!held) {
    // A new job or route is a note: UPDATE_BASELINE=1 adds it. An idle one that sends this much is not.
    console.warn(`query budget: ${group} ${name} is not in the baseline yet (${now.statements} statements, ${now.rowsRead} rows read); add it with ${FIX}`);
    expect(now.statements, `${name} is new and sends ${now.statements} statements when idle`).toBeLessThanOrEqual(20);
    return;
  }
  for (const key of keysOf(name, group)) {
    if (now[key] > held[key] + roomOf(key, held[key])) {
      const sent = support.mostRepeated(records[`${group}:${name}`] ?? []).join("\n  ");
      throw new Error(
        `${name} (${group}) now has ${now[key]} ${key}, baseline ${held[key]}: read less, or accept the growth with FIRST=1 ${FIX} and say why in the commit message. Sent most:\n  ${sent}`,
      );
    }
    if (now[key] < held[key] - roomOf(key, held[key])) console.warn(`query budget: ${name} (${group}) now has ${now[key]} ${key}, baseline ${held[key]}: lower the baseline with ${FIX}`);
  }
}

/** What 20 stores add to a name's figures: the measure of work that grows with the number of stores (0 once it does not). */
const growthOf = (name: string): Figures | null => {
  const [one, twenty] = [measured.one[name], measured.twenty[name]];
  return one && twenty ? { statements: twenty.statements - one.statements, rowsRead: twenty.rowsRead - one.rowsRead } : null;
};

/** The growth from 1 to 20 stores may not rise (rows read with the same room as above); a fall is a note. */
function compareGrowth(name: string): void {
  if (WRITE) return;
  const now = growthOf(name);
  const held = support.readBaseline().growth?.[name];
  if (!now || !held) return;
  for (const key of keysOf(name, "growth")) {
    if (now[key] > held[key] + roomOf(key, held[key])) {
      throw new Error(`${name}'s growth from 1 to 20 stores is now ${now[key]} ${key}, baseline ${held[key]}: it does more per store than it did (read the stores' work in one statement), or accept it with FIRST=1 ${FIX} and say why in the commit message`);
    }
    if (now[key] < held[key] - roomOf(key, held[key])) console.warn(`query budget: ${name}'s growth from 1 to 20 stores is now ${now[key]} ${key}, baseline ${held[key]}: lower the baseline with ${FIX}`);
  }
}

/** Writes the measured figures and the growth; a figure above its baseline only with FIRST=1. */
function write(): void {
  const before = support.readBaseline();
  const growth = Object.fromEntries(Object.keys(measured.twenty).flatMap((name) => (growthOf(name) ? [[name, growthOf(name)!]] : [])));
  const next: QueryBudget = { ...before };
  for (const [group, now] of [["one", measured.one], ["twenty", measured.twenty], ["growth", growth]] as const) {
    if (Object.keys(now).length === 0) continue;
    const held = before[group] ?? {};
    const raised = Object.entries(now).filter(([name, f]) => held[name] && keysOf(name, group).some((key) => f[key] > held[name][key]));
    if (raised.length > 0 && !RAISE) {
      throw new Error(`Not written: ${raised.map(([name]) => `${group} ${name}`).join(", ")} rose; with FIRST=1 the rise is accepted.`);
    }
    next[group] = Object.fromEntries(Object.entries(now).sort(([a], [b]) => a.localeCompare(b)));
  }
  support.writeBaseline(next);
}

/** The store's frame: what `src/app/s/[store]/[market]/layout.tsx` awaits before any page content, in the same order. */
async function storeFrame(slug: string, market: string): Promise<void> {
  await getStore(slug);
  const shop = await resolveShop(slug, market);
  if (!shop) throw new Error(`no shop ${slug}/${market}`);
  const { store, ab } = shop;
  const afterSale = featureOn(store, "shop") || (await afterSaleOpenCached(store.id));
  // One wave before <html> (bloat review step 2.18); the standard footer reads the legal links itself, a footer of the store's own none.
  const [, footer] = await Promise.all([siteLayoutForVisitor(store.id, "header", ab), siteLayoutForVisitor(store.id, "footer", ab), textStylesCssFor(store.id)]);
  if (!footer.layout) await legalLinksFor(store, shop.market, afterSale);
}


/** Kaizena Flow's frame: what `PlatformRoot` (`src/app/(platform)/layout.tsx`) awaits, then the consent banner's cookies. */
async function platformFrame(): Promise<void> {
  const [chrome, , , site] = await Promise.all([getPlatformChrome(), siteLayoutFor(null, "header"), siteLayoutFor(null, "footer"), siteStoreCached()]);
  const house = site ? await getOpenStore(site.slug) : null;
  await textStylesCssFor(null);
  await (house ? siteCookies(house.id, house.tracking, liveCustomCode(house.customCode)) : siteCookies(null, chrome.tracking));
}

const T = 120_000;

/** Parts A to D for one group: the idle jobs one by one, the minute and the daily routes, and the two cold frames. */
function parts(group: Group): void {
  // Both comparisons run, so a statement per store added fails with the figure and with the growth it raised.
  const check = (name: string, figures: Figures) => {
    const runs = [() => compare(group, name, figures), () => (group === "twenty" ? compareGrowth(name) : undefined)];
    const problems = runs.flatMap((run) => {
      try {
        run();
        return [];
      } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
      }
    });
    if (problems.length > 0) throw new Error(problems.join("\n\n"));
  };

  describe("A: the dispatcher's idle tick, job by job", () => {
    for (const key of Object.keys(DISPATCHER_JOBS) as (keyof typeof DISPATCHER_JOBS)[]) {
      const name = `dispatcher.${kebab(key)}`;
      it(name, async () => check(name, await count(group, name, () => DISPATCHER_JOBS[key]())), T);
    }
  });

  describe("B and C: the minute routes and the daily routes", () => {
    for (const route of [...MINUTE_ROUTES, ...DAILY_ROUTES]) {
      const name = `route.${route}`;
      it(name, async () => {
        network.current = name;
        expect((await callRoute(route)).status, name).toBe(200);
        check(name, await count(group, name, () => callRoute(route)));
      }, T);
    }
  });

  describe("D: a cold frame", () => {
    // Rewritten first: a table the jobs updated grew by a page or not as the pruning of its old rows fell, and the planner, which weighs a
    // scan by the pages, then read the stores' rows whole or through their index (444 or 400 rows read with 20 stores, by chance). A plain
    // vacuum frees the space but keeps the pages; vacuum full packs every table as the same rows always pack.
    beforeAll(async () => {
      await support.side()`vacuum full`;
    }, T);

    it("frame.store", async () => check("frame.store", await count(group, "frame.store", () => storeFrame("demo", "no"))), T);
    it("frame.platform", async () => check("frame.platform", await count(group, "frame.platform", () => platformFrame())), T);
    // The consent banner's cookies for the demo store (`MarketExtras`, in its own boundary): one site-facts statement (bloat review step 2.18).
    it("siteCookies.store", async () => {
      const demo = await getStore("demo");
      if (!demo) throw new Error("no store demo");
      check("siteCookies.store", await count(group, "siteCookies.store", () => siteCookies(demo.id, demo.tracking)));
    }, T);
  });
}

/** The demo store's published pages read as `listPublishedPages()` reads them, and by a copy that filters as step 0.23 stopped. */
const demoId = async () => (await getStore("demo"))!.id;
const pagesAsBefore = async (storeId: string) =>
  db().execute(sql`
    select id, slug, published, published_at, first_published_at from commerce.pages
    where store_id is not distinct from ${storeId}::uuid and type = 'page' and published_at is not null order by created_at
  `);
const pageReads: Partial<Record<Group, { fn: Figures; copy: Figures }>> = {};
async function measurePageReads(group: Group): Promise<void> {
  const id = await demoId();
  await listPublishedPages(id);
  await pagesAsBefore(id);
  const fn = await support.measure(() => listPublishedPages(id));
  const copy = await support.measure(() => pagesAsBefore(id));
  pageReads[group] = { fn: { statements: fn.statements, rowsRead: fn.rowsRead }, copy: { statements: copy.statements, rowsRead: copy.rowsRead } };
}

describe("query budget with one store", () => {
  parts("one");

  it("measures the demo store's published pages, for the 20 stores to compare", async () => {
    await measurePageReads("one");
    expect(pageReads.one!.fn.statements).toBe(1);
  }, T);
});

describe("query budget with 20 stores", () => {
  // A fixed run: what some reads fetch moves with the names the seed writes. What an earlier run left, if it stopped half way, goes first.
  const run = "qb";

  beforeAll(async () => {
    await removeSeed(run);
    // 20 stores of their own with every per-store feature on (the demo store is left as the seed made it, so the next run on this database
    // counts the same one store).
    await seedStores({ count: 20, features: "all", run });
    await support.side()`vacuum analyze`;
  }, 300_000);

  afterAll(async () => {
    await removeSeed(run);
  }, T);

  it("seeds the 14 features it says", () => {
    console.info(`query budget: 20 stores with ${SEEDED_FEATURES.join(", ")}`);
    expect(SEEDED_FEATURES).toHaveLength(14);
  });

  parts("twenty");

  it("would notice one more statement per store beside a job", async () => {
    const job = measured.twenty["dispatcher.alt-texts"];
    expect(job, "dispatcher.alt-texts was measured with 20 stores").toBeDefined();
    const ids = await db().execute<{ id: string }>(sql`select id from commerce.stores where slug like ${`budget-${run}-%`}`);
    expect(ids).toHaveLength(20);
    const more = await support.measure(async () => {
      await DISPATCHER_JOBS.altTexts();
      for (const { id } of ids) await db().execute(sql`select 1 from commerce.stores where id = ${id}::uuid`);
    });
    expect(more.statements).toBe(job.statements + 20);
  }, T);

  it("would notice a read that filters a store's pages so no index serves it", async () => {
    await measurePageReads("twenty");
    const { one, twenty } = pageReads;
    expect(one && twenty, "both groups measured").toBeTruthy();
    // listPublishedPages() filters with owned() (step 0.23): the other stores' pages are never read (with one store's few pages the planner
    // may read the small table whole, so it reads no more, not exactly as many).
    expect(twenty!.fn.rowsRead).toBeLessThanOrEqual(one!.fn.rowsRead);
    // The old filter reads every store's pages: 20 stores of 30 pages and more.
    expect(twenty!.copy.rowsRead).toBeGreaterThan(one!.copy.rowsRead + 20 * 30);
  }, T);

  it("holds the ledger's statements with 20 open books, so one more per book fails", async () => {
    // The busy tick has its own name: dispatcher.ledger above is the idle one, where a book looked at is not listed again (step 3.22).
    const held = support.readBaseline().twenty?.["dispatcher.ledger.busy"];
    const books = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.ledger_books where closed_on is null`);
    expect(books[0].n).toBeGreaterThanOrEqual(20);
    await runLedgerPosting();
    // A busy tick: every book due (bloat review step 3.22 skips an idle book between hourly looks).
    await db().execute(sql`update commerce.ledger_books set checked_at = null where closed_on is null`);
    const now = await support.measure(() => runLedgerPosting());
    // An idle tick lists no book, so it costs what one store's does.
    const idle = await support.measure(() => runLedgerPosting());
    expect(idle.statements).toBe(measured.one["dispatcher.ledger"]!.statements);
    measured.twenty["dispatcher.ledger.busy"] = { statements: now.statements, rowsRead: now.rowsRead };
    // The baseline holds what 20 due books cost; a statement more per book is 20 more and fails here.
    if (!WRITE) expect(now.statements).toBe(held!.statements);
    expect(now.statements - measured.one["dispatcher.ledger"]!.statements).toBeGreaterThanOrEqual(20);
  }, T);
});

it("reaches the network only where REACHES_NETWORK says", () => {
  const now = [...reached.keys()].sort();
  for (const name of now) expect(REACHES_NETWORK, `${name} tried ${[...reached.get(name)!].join(", ")}`).toContain(name);
  for (const name of REACHES_NETWORK) expect(now, `${name} no longer tries the network: take it off REACHES_NETWORK`).toContain(name);
});
