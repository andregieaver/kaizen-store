import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
// The platform's host, so a store without a domain of its own is measured at its path there (`/s/{slug}`).
process.env.SITE_URL = "https://kaizenaflow.com";

const { closeDb, db } = await import("@/db/client");
const { makeAccount, makeStore } = await import("./trust-fixtures");
const speed = await import("./site-speed");
const { addRival } = await import("./market-rivals");
const { marketCheck } = await import("./market-check");
const { getStore } = await import("./stores");
const { customPeriod } = await import("@/lib/analytics-period");

type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;

/**
 * How fast a store's site and its rivals' are (D905 M5c) against the database, with a stand-in for the Chrome UX Report: nothing read
 * until a platform admin sets the key, kept encrypted; a store's own site asked at its path on the platform's host, a rival by its origin
 * and its `www.` twin; a site with too few visitors said so; a rival good where the store is poor found; the key removed.
 */

let store: Store;
let account: { id: string };
const asked: { url: string; target: Record<string, string> }[] = [];

const answer = (lcp: number, inp: number, cls: string) => ({
  record: {
    metrics: {
      largest_contentful_paint: { percentiles: { p75: lcp } },
      interaction_to_next_paint: { percentiles: { p75: inp } },
      cumulative_layout_shift: { percentiles: { p75: cls } },
    },
    collectionPeriod: { lastDate: { year: 2026, month: 11, day: 23 } },
  },
});

/** The report as it answers: figures for the store's page and Linnet's `www.` origin, 404 for anything else. */
const report = (async (url: string, init?: RequestInit) => {
  const target = JSON.parse(String(init?.body)) as Record<string, string>;
  asked.push({ url, target });
  const figures: Record<string, unknown> = {
    [`https://kaizenaflow.com/s/${store.slug}`]: answer(4800, 180, "0.04"),
    "https://www.linnet.no": answer(1900, 150, "0.02"),
  };
  const found = figures[target.url ?? target.origin];
  return found
    ? new Response(JSON.stringify(found), { status: 200, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ error: { code: 404, message: "chrome ux report data not found" } }), { status: 404 });
}) as typeof fetch;

beforeAll(async () => {
  const made = await makeStore("site-speed");
  account = made.account;
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${made.id}::uuid`);
  store = (await getStore(made.slug))!;
  await addRival({ account, store }, { market: "NO", name: "Linnet", address: "https://www.linnet.no" });
  await addRival({ account, store }, { market: "NO", name: "Furu", address: "furu.no" });
  await db().execute(sql`delete from commerce.speed_settings`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.speed_settings`);
  await closeDb();
});

describe("site speed (D905 M5c)", () => {
  it("reads nothing until a platform admin sets the key, which is kept encrypted and shown by its hint", async () => {
    expect(await speed.watchSiteSpeeds({ fetch: report })).toEqual({ stores: 0, measured: 0, none: 0, failed: 0 });
    expect(asked).toEqual([]);
    await expect(speed.saveSpeedKey({ ...account, email: "x@example.com", name: "x", platformAdmin: false } as never, { apiKey: "AIzaKey1234" })).rejects.toThrow("Only a platform admin");
    const admin = await makeAccount("speed-admin", { platformAdmin: true });
    await expect(speed.saveSpeedKey(admin, { apiKey: "" })).rejects.toThrow("Paste the Chrome UX Report API key");
    await expect(speed.saveSpeedKey(admin, { apiKey: "not a key" })).rejects.toThrow("not an API key");
    expect(await speed.saveSpeedKey(admin, { apiKey: "AIzaKey1234" })).toEqual({ keyHint: "…1234" });
    const [row] = await db().execute<Record<string, unknown>>(sql`select key_encrypted from commerce.speed_settings`);
    expect(String(row.key_encrypted)).not.toContain("AIzaKey1234");
    // An empty key keeps the saved one.
    expect(await speed.saveSpeedKey(admin, { apiKey: "" })).toEqual({ keyHint: "…1234" });
  });

  it("measures a store's own site and its rivals' monthly, a rival by its www twin when the bare host has none", async () => {
    // Only this store is due: every other open store was measured now.
    await db().execute(sql`
      insert into commerce.site_speeds (store_id, site, own, tried_at)
      select s.id, 'elsewhere.example', true, now() from commerce.stores s where s.id <> ${store.id}::uuid
      on conflict (store_id, site) do update set tried_at = now()`);
    expect(await speed.watchSiteSpeeds({ fetch: report })).toEqual({ stores: 1, measured: 2, none: 1, failed: 0 });
    expect(asked.every((a) => a.url === "https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=AIzaKey1234")).toBe(true);
    expect(asked.map((a) => a.target.url ?? a.target.origin)).toEqual([
      `https://kaizenaflow.com/s/${store.slug}`,
      "https://furu.no",
      "https://www.furu.no",
      "https://linnet.no",
      "https://www.linnet.no",
    ]);
    const sites = await speed.listSiteSpeeds(store.id);
    expect(sites.map((s) => [s.rivalName, s.lcp, s.inp, s.cls, s.periodEnd, s.problem])).toEqual([
      [null, 4800, 180, 40, "2026-11-23", null],
      ["Furu", null, null, null, null, "none"],
      ["Linnet", 1900, 150, 20, "2026-11-23", null],
    ]);
    // Measured now: nothing is due for a month.
    expect((await speed.watchSiteSpeeds({ fetch: report })).stores).toBe(0);
  });

  it("finds a rival good where the store is poor, in the market check", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const check = await marketCheck(store, customPeriod(today, today), { now: new Date() });
    expect(check.findings.filter((f) => f.kind === "speed_behind")).toEqual([{ kind: "speed_behind", metric: "lcp", rivalName: "Linnet", theirs: 1900, yours: 4800 }]);
    expect(check.siteSpeeds).toHaveLength(3);
  });

  it("drops a site no longer a rival's at the next reading, and reads nothing once the key is removed", async () => {
    await db().execute(sql`delete from commerce.market_rivals where store_id = ${store.id}::uuid and host = 'furu.no'`);
    await db().execute(sql`update commerce.site_speeds set tried_at = now() - interval '31 days' where store_id = ${store.id}::uuid`);
    expect((await speed.watchSiteSpeeds({ fetch: report })).stores).toBe(1);
    expect((await speed.listSiteSpeeds(store.id)).map((s) => s.host)).toEqual([`kaizenaflow.com/s/${store.slug}`, "linnet.no"]);
    const admin = await makeAccount("speed-admin-2", { platformAdmin: true });
    await speed.removeSpeedKey(admin);
    expect(await speed.speedSettings()).toBeNull();
    await db().execute(sql`update commerce.site_speeds set tried_at = now() - interval '31 days' where store_id = ${store.id}::uuid`);
    expect((await speed.watchSiteSpeeds({ fetch: report })).stores).toBe(0);
  });
});
