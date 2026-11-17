import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const ownerTools = await import("./owner-tools");
const { getStore } = await import("./stores");

/**
 * The AI manager's heatmap tools (D656 step 14), run as the assistant and the store's MCP server run them, through `runOwnerTool()`:
 * the same totals as Analytics → Heatmaps and an A/B test's page, nothing for a page below its minimum, and a test of another store
 * not found. Seeded totals, as the heat route would have added them.
 */

const run = Date.now().toString(36);
const slug = `heattools-${run}`;
let store: Store;
let experiment: string;
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;
const ctx = (holder: { role: "owner" | "admin"; permissions?: string[] } = { role: "owner" }) => ({
  account: { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", name: "Owner", platformAdmin: false } as Account,
  store,
  holder,
  invalidate: () => {},
});
const call = (name: string, input: unknown = {}, holder?: { role: "owner" | "admin"; permissions?: string[] }) => ownerTools.runOwnerTool(ctx(holder), name, input) as Promise<Answer>;

const totals = (page: string, device: string, tag: string, views: number, frustrated: number, half: number) => {
  const reach = new Array<number>(21).fill(0);
  reach[20] = half;
  reach[3] = views - half;
  const attention = new Array<number>(20).fill(0);
  attention[0] = views * 3000;
  return sql`
    insert into commerce.page_heat_days (store_id, day, page, device, tag, views, reach, fold_sum, attention_ms, att_height_sum, clicks, dead_clicks, rage_clicks, dead_views, rage_views, frustrated_views)
    values (${store.id}::uuid, (now() at time zone 'Europe/Oslo')::date, ${page}, ${device}, ${tag}, ${views}, ${`{${reach.join(",")}}`}::int[], ${views * 400},
      ${`{${attention.join(",")}}`}::bigint[], ${views * 2000}, ${views}, ${frustrated}, 0, ${frustrated}, 0, ${frustrated})`;
};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Heat tools', null) as id`);
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo', heatmaps = true where id = ${String(created.id)}::uuid`);
  store = (await getStore(slug))!;
  await db().execute(totals("/no", "mobile", "", 400, 20, 200));
  await db().execute(totals("/no/p/mug", "mobile", "", 80, 40, 20));
  await db().execute(totals("/no/p/new", "mobile", "", 12, 10, 1));
  await db().execute(sql`
    insert into commerce.click_cells (store_id, day, page, device, anchor, cx, cy, clicks, dead, rage)
    values (${store.id}::uuid, (now() at time zone 'Europe/Oslo')::date, '/no/p/mug', 'mobile', '@header', 2, 3, 30, 12, 4)`);
  const [page] = await db().execute<Row>(sql`select id, published from commerce.pages where store_id = ${store.id}::uuid and type = 'page' and slug = 'om-oss'`);
  const copySlug = `ab-${run}-b`;
  const [copy] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, slug, draft, published, published_at, type)
    values (${store.id}::uuid, ${copySlug}, ${JSON.stringify({ ...(page.published as object), slug: copySlug })}::jsonb, ${JSON.stringify({ ...(page.published as object), slug: copySlug })}::jsonb, now(), 'variant')
    returning id`);
  const [made] = await db().execute<Row>(sql`insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values (${store.id}::uuid, 'Shorter story', ${String(page.id)}::uuid, 'orders') returning id`);
  experiment = String(made.id);
  await db().execute(sql`
    insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
    values (${store.id}::uuid, ${experiment}::uuid, 'a', 'Original', null, 0.5), (${store.id}::uuid, ${experiment}::uuid, 'b', 'Version B', ${String(copy.id)}::uuid, 0.5)`);
  await db().execute(totals("/no/om-oss", "mobile", `${experiment}:a`, 2500, 60, 1500));
  await db().execute(totals("/no/om-oss", "mobile", `${experiment}:b`, 2500, 300, 1000));
});

afterAll(async () => {
  await closeDb();
});

describe("page_behaviour (D656)", () => {
  it("ranks where visitors get stuck from 30 page views, as the hub does", async () => {
    const out = await call("page_behaviour", { days: 30 });
    expect(out.measuring).toBe("Heatmaps are on.");
    expect(out.where_visitors_get_stuck.map((p: Answer) => p.page)).toEqual(["/no/p/mug", "/no"]);
    expect(out.where_visitors_get_stuck[0].page_views_with_dead_or_rage_clicks).toMatch(/^50(\.0)? %$/);
    expect(out.not_enough_yet).toBe(1);
    expect(out.page).toBe(`/admin/${slug}/analytics/heatmaps`);
  });

  it("gives one page's reach, attention and parts, and nothing below the minimum", async () => {
    const out = await call("page_behaviour", { page: "/no/p/mug", days: 30 });
    expect(out.device).toBe("phone");
    expect(out.page_views).toBe(80);
    expect(out.reached["100 % of the page"]).toMatch(/^25(\.0)? % of page views$/);
    expect(out.attention[0]).toEqual({ part: "0–5 % down", seconds_per_page_view: "3.0" });
    expect(out.parts_clicked_most).toEqual([{ part: "Header", clicks: "30", dead_clicks: "12", rage_clicks: "4" }]);
    expect((await call("page_behaviour", { page: "/no/p/new", days: 30 })).figures).toMatch(/^not enough page views yet/);
    await expect(call("page_behaviour", { page: "no page", days: 30 })).rejects.toThrow(/not a page key/);
  });

  it("is refused to a member without analytics", async () => {
    await expect(call("page_behaviour", { days: 30 }, { role: "admin", permissions: ["products:read"] })).rejects.toThrow(/no access to analytics/);
  });
});

describe("version_behaviour (D656)", () => {
  it("gives each version's figures and names the one with clearly more frustrated clicks", async () => {
    const out = await call("version_behaviour", { experiment });
    expect(out.test).toBe("Shorter story");
    expect(out.versions.map((v: Answer) => v.version)).toEqual(["Original", "Version B"]);
    expect(out.versions[1].page_views_with_dead_clicks).toMatch(/^12(\.0)? %$/);
    expect(out.clearly_more_frustrated).toMatch(/^Version B gets clearly more rage or dead clicks/);
    expect(out.page).toBe(`/admin/${slug}/experiments/${experiment}#ab-behaviour`);
  });

  it("does not find another store's test", async () => {
    await expect(call("version_behaviour", { experiment: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/No A\/B test of this store/);
  });
});
