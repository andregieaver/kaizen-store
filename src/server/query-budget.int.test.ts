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
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({
  connection: async () => {},
  after: (task: (() => unknown) | Promise<unknown>) => void pending.push(typeof task === "function" ? task : () => task),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
process.env.CRON_SECRET = "query-budget";
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const support = await import("./query-budget-test-support");
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
];

const ROUTES = Object.fromEntries(
  await Promise.all(
    [...MINUTE_ROUTES, ...DAILY_ROUTES].map(async (name) => [name, ((await import(`../app/api/cron/${name}/route.ts`)) as { POST: (r: Request) => Promise<Response> }).POST]),
  ),
) as Record<string, (r: Request) => Promise<Response>>;

const realFetch = globalThis.fetch;
const originals: (() => unknown)[] = [];
const reached = network.reached;

/** The figures this run measured, by group, and their records, by name. */
const measured: { one: Record<string, Figures> } = { one: {} };
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
  // Vacuumed and analysed first, so the planner's statistics and the visibility map are as they will stay: autovacuum would otherwise come by
  // in the middle of a run and turn an index scan into an index-only one, and the rows read would change with when it came.
  await support.side()`vacuum analyze`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const restore of originals) restore();
  syncBuiltinESMExports();
  vi.useRealTimers();
  if (WRITE) write();
  await closeDb();
  await support.closeSide();
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
async function count(group: keyof typeof measured, name: string, work: () => Promise<unknown>): Promise<Figures> {
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

/** A figure above the baseline fails with both numbers and what was sent most; one below asks for the baseline to be lowered. */
function compare(group: keyof typeof measured, name: string, now: Figures): void {
  // With UPDATE_BASELINE=1 the figures are written in afterAll, which refuses a rise without FIRST=1.
  if (WRITE) return;
  const held = support.readBaseline()[group]?.[name];
  if (!held) {
    // A new job or route is a note: UPDATE_BASELINE=1 adds it. An idle one that sends this much is not.
    console.warn(`query budget: ${group} ${name} is not in the baseline yet (${now.statements} statements, ${now.rowsRead} rows read); add it with ${FIX}`);
    expect(now.statements, `${name} is new and sends ${now.statements} statements when idle`).toBeLessThanOrEqual(20);
    return;
  }
  for (const key of ["statements", "rowsRead"] as const) {
    if (now[key] > held[key]) {
      const sent = support.mostRepeated(records[`${group}:${name}`] ?? []).join("\n  ");
      throw new Error(
        `${name} (${group}) now has ${now[key]} ${key}, baseline ${held[key]}: read less, or accept the growth with FIRST=1 ${FIX} and say why in the commit message. Sent most:\n  ${sent}`,
      );
    }
    if (now[key] < held[key]) throw new Error(`${name} (${group}) now has ${now[key]} ${key}, baseline ${held[key]}: lower the baseline with ${FIX}`);
  }
}

/** Writes the measured figures; a figure above its baseline only with FIRST=1. */
function write(): void {
  const before = support.readBaseline();
  const next = { ...before };
  for (const group of Object.keys(measured) as (keyof typeof measured)[]) {
    const now = measured[group];
    const held = before[group] ?? {};
    const raised = Object.entries(now).filter(([name, f]) => held[name] && (f.statements > held[name].statements || f.rowsRead > held[name].rowsRead));
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
  await Promise.all([siteLayoutForVisitor(store.id, "header", ab), siteLayoutForVisitor(store.id, "footer", ab), legalLinksFor(store, shop.market, afterSale)]);
  await textStylesCssFor(store.id);
}

/** Kaizena Flow's frame: what `PlatformRoot` (`src/app/(platform)/layout.tsx`) awaits, then the consent banner's cookies. */
async function platformFrame(): Promise<void> {
  const [chrome, , , site] = await Promise.all([getPlatformChrome(), siteLayoutFor(null, "header"), siteLayoutFor(null, "footer"), siteStoreCached()]);
  const house = site ? await getOpenStore(site.slug) : null;
  await textStylesCssFor(null);
  await (house ? siteCookies(house.id, house.tracking, liveCustomCode(house.customCode)) : siteCookies(null, chrome.tracking));
}

const T = 120_000;

describe("query budget with one store", () => {
  describe("A: the dispatcher's idle tick, job by job", () => {
    for (const key of Object.keys(DISPATCHER_JOBS) as (keyof typeof DISPATCHER_JOBS)[]) {
      const name = `dispatcher.${kebab(key)}`;
      it(name, async () => compare("one", name, await count("one", name, () => DISPATCHER_JOBS[key]())), T);
    }
  });

  describe("B and C: the minute routes and the daily routes", () => {
    for (const route of [...MINUTE_ROUTES, ...DAILY_ROUTES]) {
      const name = `route.${route}`;
      it(name, async () => {
        network.current = name;
        expect((await callRoute(route)).status, name).toBe(200);
        compare("one", name, await count("one", name, () => callRoute(route)));
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

    it("frame.store", async () => compare("one", "frame.store", await count("one", "frame.store", () => storeFrame("demo", "no"))), T);
    it("frame.platform", async () => compare("one", "frame.platform", await count("one", "frame.platform", () => platformFrame())), T);
  });

  it("reaches the network only where REACHES_NETWORK says", () => {
    const now = [...reached.keys()].sort();
    for (const name of now) expect(REACHES_NETWORK, `${name} tried ${[...reached.get(name)!].join(", ")}`).toContain(name);
    for (const name of REACHES_NETWORK) expect(now, `${name} no longer tries the network: take it off REACHES_NETWORK`).toContain(name);
  });
});
