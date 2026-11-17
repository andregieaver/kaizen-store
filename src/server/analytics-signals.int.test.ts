import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, todayIn } from "@/lib/analytics-period";
import { storeDayKey } from "@/lib/visit-hash";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const insights = await import("./analytics-insights");
const watch = await import("./domain-watch");
const health = await import("./domain-health");
type Store = import("./stores").Store;
type Row = Record<string, unknown>;

/**
 * The alerts of ecosystem plan E4.2 (D729) against a real database: a page where visitors get stuck more often, read from its heat totals;
 * a kind of page that turned slow, worked out by the database from speed samples; a domain whose health fails, from the daily domain watch
 * (a stand-in for the question to the domain) and the store's own rows. Each reaches `alertsForStore()`, which the Overview, Home, the
 * alert emails, the briefing and the autopilot's alert events all read.
 */

let store: Store;
let today: string;
const run = Date.now().toString(36);
const NOW = new Date();

const zeros = (n: number) => `{${Array(n).fill(0).join(",")}}`;

async function heat(page: string, day: string, views: number, frustrated: number): Promise<void> {
  await db().execute(sql`
    insert into commerce.page_heat_days (store_id, day, page, device, tag, views, reach, attention_ms, frustrated_views, dead_views)
    values (${store.id}::uuid, ${day}::date, ${page}, 'mobile', '', ${views}, ${zeros(21)}::int[], ${zeros(20)}::bigint[], ${frustrated}, ${frustrated})
  `);
}

async function samples(n: number, lcp: number, daysAgo: number): Promise<void> {
  const day = addDays(storeDayKey(NOW, store.timeZone), -daysAgo);
  await db().execute(sql`
    insert into commerce.speed_samples (store_id, day, kind, screen, lcp_ms)
    select ${store.id}::uuid, ${day}::date, 'product', 'phone', ${lcp} + g from generate_series(1, ${n}) g
  `);
}

async function domain(hostname: string, status: "pending" | "active", over: { primary?: boolean; createdDaysAgo?: number; checks?: object } = {}): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.store_domains (store_id, hostname, token, status, is_primary, checks, created_at, activated_at)
    values (${store.id}::uuid, ${hostname}, ${`t${run}${hostname.length}`}, ${status}, ${over.primary ?? false}, ${JSON.stringify(over.checks ?? {})}::jsonb,
      now() - make_interval(days => ${over.createdDaysAgo ?? 0}), case when ${status} = 'active' then now() end)
    returning id
  `);
  return String(row.id);
}

beforeAll(async () => {
  const made = await makeStore("signals");
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${made.id}::uuid`);
  store = (await getStore(made.slug))!;
  today = todayIn(NOW, store.timeZone);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.store_domains where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_event_checks where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("a page where visitors get stuck more often", () => {
  it("is read from the page's heat totals, the last 7 complete days against the 28 before, and links to its heatmap", async () => {
    // The four weeks before: 40 views a day, 2 of them stuck (5 %). The last week: 40 a day, 8 stuck (20 %). Today is left out.
    for (let k = 8; k <= 35; k++) await heat("/no/p/mug", addDays(today, -k), 40, 2);
    for (let k = 1; k <= 7; k++) await heat("/no/p/mug", addDays(today, -k), 40, 8);
    await heat("/no/p/mug", today, 1000, 1000);
    // A page with too few views in the week says nothing however it moved.
    for (let k = 1; k <= 7; k++) await heat("/no/om-oss", addDays(today, -k), 10, 10);
    const rows = await insights.pageFrustrationRows(store, today);
    expect(rows).toEqual([{ page: "/no/p/mug", views7: 280, frustrated7: 56, viewsBefore: 1120, frustratedBefore: 56 }]);
    const alert = (await insights.alertsForStore(store, NOW)).find((a) => a.id === "page-frustration");
    expect(alert).toMatchObject({ severity: "warning", href: "/analytics/heatmaps?page=%2Fno%2Fp%2Fmug" });
    expect(alert?.text).toContain("20 % of its page views had a dead or rage click over the last 7 days, against 5 %");
  });
});

describe("a kind of page that turned slow", () => {
  it("is worked out by the database per kind and screen, the last 7 days against the 21 before", async () => {
    await samples(120, 2000, 10);
    await samples(60, 5000, 2);
    const rows = await insights.speedWindowRows(store, NOW);
    const lcp = rows.find((r) => r.kind === "product" && r.screen === "phone" && r.metric === "lcp");
    expect(lcp).toMatchObject({ recent: { n: 60, p75: 5045 }, before: { n: 120, p75: 2090 } });
    expect(rows.find((r) => r.metric === "inp")).toMatchObject({ recent: { n: 0, p75: null } });
    const alert = (await insights.alertsForStore(store, NOW)).find((a) => a.id === "page-slow");
    expect(alert).toMatchObject({ severity: "warning", href: "/analytics/speed" });
    // Figures in the store's own way of writing numbers, as its amounts are.
    expect(alert?.text).toMatch(/^Product pages on phones turned slow over the last 7 days: main content shown at 5[.,]05 s, against 2[.,]09 s over the three weeks before \(above 4[.,]00 s is poor\)\.$/);
  });
});

describe("a store domain whose health fails", () => {
  const hosts = { address: `shop-${run}.example.no`, waiting: `new-${run}.example.no`, fresh: `www-${run}.example.no` };

  it("asks each active domain once a day, keeps the answer beside its checks, and leaves waiting ones to their own check", async () => {
    const id = await domain(hosts.address, "active", { primary: true, checks: { apexName: `shop-${run}.example.no`, txt: true, misconfigured: false } });
    await domain(hosts.waiting, "pending", { createdDaysAgo: 3, checks: { txt: true, misconfigured: true } });
    const asked: string[] = [];
    const first = await watch.watchDomains({
      probe: async (hostname) => (asked.push(hostname), hostname === hosts.address ? "elsewhere" : "ok"),
      rdap: async () => ({ registrar: "Domeneshop AS", expiresAt: "2027-09-01T00:00:00.000Z" }),
      now: NOW,
    });
    expect(asked).toContain(hosts.address);
    expect(asked).not.toContain(hosts.waiting);
    expect(first.failing).toBeGreaterThanOrEqual(1);
    const [row] = await db().execute<Row>(sql`select checks from commerce.store_domains where id = ${id}::uuid and store_id = ${store.id}::uuid`);
    expect(row.checks).toMatchObject({ apexName: `shop-${run}.example.no`, txt: true, watch: { serving: "elsewhere", registrar: "Domeneshop AS", expiresAt: "2027-09-01T00:00:00.000Z" } });
    // Asked again only a day later.
    const again: string[] = [];
    await watch.watchDomains({ probe: async (hostname) => (again.push(hostname), "ok"), rdap: async () => null, now: NOW });
    expect(again).not.toContain(hosts.address);
  });

  it("raises an urgent alert for the address that no longer reaches the store, and counts the domain still waiting", async () => {
    const alert = (await insights.alertsForStore(store, NOW)).find((a) => a.id === "domain-problem");
    expect(alert).toMatchObject({ severity: "urgent", href: "/settings/domains" });
    expect(alert?.text).toMatch(new RegExp(`^shop-${run}\\.example\\.no no longer reaches your store: when it was checked on \\d{4}-\\d{2}-\\d{2}`));
    expect(alert?.text).toMatch(/ Another domain needs a look too\.$/);
    expect(alert?.evidence.map((e) => e.label)).toEqual([hosts.address, hosts.waiting]);
  });

  it("shows the same finding on the Domains page's health, which asks the world itself", async () => {
    const quiet = { mx: async () => [], txt: async () => [], caa: async () => [], ns: async () => [] };
    const rows = await health.storeDomainHealth(store.id, { dns: quiet, rdap: async () => null, host: null, now: NOW });
    const address = rows.find((r) => r.facts.hostname === hosts.address);
    expect(address?.findings.map((f) => f.code)).toContain("points_away");
  });

  it("reaches the autopilot as alert events, like every other rule, once a week each", async () => {
    await db().execute(sql`
      insert into commerce.autopilot_settings (store_id, planning, updated_at) values (${store.id}::uuid, '{"reacts": true}'::jsonb, now())
      on conflict (store_id) do update set planning = excluded.planning
    `);
    const { detectEvents } = await import("./autopilot-events");
    // A run checks a few stores' alerts (oldest check first): other test stores that react may come before this one.
    for (let i = 0; i < 10; i++) {
      await detectEvents({ stockoutCheck: false, now: NOW });
      const [checked] = await db().execute<Row>(sql`select 1 from commerce.autopilot_event_checks where store_id = ${store.id}::uuid`);
      if (checked) break;
    }
    const events = await db().execute<Row>(sql`select ref, facts from commerce.autopilot_events where store_id = ${store.id}::uuid and kind = 'alert' order by ref`);
    expect(events.map((e) => String(e.ref).replace(/:\d{4}-W\d{2}$/, ""))).toEqual(["domain-problem", "page-frustration", "page-slow"]);
    expect(events.find((e) => String(e.ref).startsWith("domain-problem"))?.facts).toMatchObject({ kind: "alert", severity: "urgent" });
    await db().execute(sql`delete from commerce.autopilot_events where store_id = ${store.id}::uuid`);
    await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.id}::uuid`);
  });

  it("goes quiet once the domain serves the store again, and when the watch's answer is too old to say", async () => {
    await db().execute(sql`
      update commerce.store_domains set checks = checks || jsonb_build_object('watch', jsonb_build_object('at', ${NOW.toISOString()}::text, 'serving', 'ok'))
      where store_id = ${store.id}::uuid and hostname = ${hosts.address}
    `);
    await db().execute(sql`delete from commerce.store_domains where store_id = ${store.id}::uuid and hostname = ${hosts.waiting}`);
    expect((await insights.alertsForStore(store, NOW)).find((a) => a.id === "domain-problem")).toBeUndefined();
    const old = new Date(NOW.getTime() - 4 * 86_400_000).toISOString();
    await db().execute(sql`
      update commerce.store_domains set checks = checks || jsonb_build_object('watch', jsonb_build_object('at', ${old}::text, 'serving', 'elsewhere'))
      where store_id = ${store.id}::uuid and hostname = ${hosts.address}
    `);
    expect((await insights.alertsForStore(store, NOW)).find((a) => a.id === "domain-problem")).toBeUndefined();
  });
});

describe("what the watch reads from an answer", () => {
  it("knows the store's own health, a redirect, a server's error and another site's page apart", () => {
    const own = JSON.stringify({ status: "ok", region: "dub1", commit: "abc", supabase: "ok" });
    expect(watch.servingOfAnswer(200, own)).toBe("ok");
    expect(watch.servingOfAnswer(503, JSON.stringify({ status: "degraded", region: "dub1", commit: null }))).toBe("ok");
    expect(watch.servingOfAnswer(308, null)).toBeNull();
    expect(watch.servingOfAnswer(502, "<html>Bad gateway</html>")).toBeNull();
    expect(watch.servingOfAnswer(200, "<html>This domain is for sale</html>")).toBe("elsewhere");
    expect(watch.servingOfAnswer(404, "Not found")).toBe("elsewhere");
    expect(watch.isOwnHealth('{"status":"ok"}')).toBe(false);
  });

  it("reads a certificate error as a failing certificate, nothing listening as elsewhere, and a time-out as not known", () => {
    for (const code of ["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"]) {
      expect(watch.servingOfError(code), code).toBe("certificate");
    }
    expect(watch.servingOfError("ECONNREFUSED")).toBe("elsewhere");
    expect(watch.servingOfError("ETIMEDOUT")).toBeNull();
    expect(watch.servingOfError("ECONNRESET")).toBeNull();
    expect(watch.servingOfError(undefined)).toBeNull();
  });
});
