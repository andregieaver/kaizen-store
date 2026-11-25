import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.FACEBOOK_APP_ID = "1234";
process.env.FACEBOOK_APP_SECRET = "app-secret";
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const fb = await import("./facebook-pages");

/**
 * A store's Facebook Page (D870 S1.2b): connected through Facebook Login (scripted here, nothing reaches Facebook), chosen among the
 * person's Pages, its posts' figures read by the daily run into `social_post_insights`, shown, and gone with a disconnect.
 */

type Store = Awaited<ReturnType<typeof makeStore>>;
let one: Store;
let two: Store;
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().replace("Z", "+0000");

const PAGES = (n: number) => ({ data: [{ id: "5550001", name: "Keramikk", access_token: "page-token-1" }, ...(n > 1 ? [{ id: "5550002", name: "Other shop", access_token: "page-token-2" }] : [])] });
let pageCount = 1;
let insightsAllowed = true;
const asked: string[] = [];

function answer(url: URL): unknown {
  const path = url.pathname.replace("/v24.0", "");
  if (path === "/oauth/access_token") return { access_token: url.searchParams.get("grant_type") ? "long-user-token" : "short-user-token", token_type: "bearer" };
  if (path === "/me/accounts") return PAGES(pageCount);
  if (path === "/me/permissions") return { data: [{ permission: "pages_show_list", status: "granted" }, { permission: "read_insights", status: insightsAllowed ? "granted" : "declined" }] };
  if (path.endsWith("/published_posts")) {
    return {
      data: [
        { id: "5550001_1", message: "New bowls", created_time: daysAgo(3), permalink_url: "https://www.facebook.com/5550001/posts/1", status_type: "added_photos", shares: { count: 2 }, reactions: { summary: { total_count: 20 } }, comments: { summary: { total_count: 3 } } },
        { id: "5550001_2", message: "Old", created_time: daysAgo(120) },
      ],
    };
  }
  if (path.endsWith("/insights")) {
    // The newer metrics are refused, as for a Page Meta has not moved yet: the older ones answer.
    if (url.searchParams.get("metric")?.startsWith("post_total_media_view")) return { __status: 400, error: { message: "(#100) The value must be a valid insights metric" } };
    return { data: [{ name: "post_impressions_unique", values: [{ value: 640 }] }, { name: "post_impressions", values: [{ value: 900 }] }] };
  }
  return { __status: 404, error: { message: "Unknown path" } };
}

beforeAll(async () => {
  [one, two] = await Promise.all([makeStore("facebook-one"), makeStore("facebook-two")]);
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    asked.push(url.pathname);
    const body = answer(url) as { __status?: number };
    return new Response(JSON.stringify(body), { status: body.__status ?? 200, headers: { "content-type": "application/json" } });
  });
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await db().execute(sql`delete from commerce.facebook_pages where store_id in (${one.id}::uuid, ${two.id}::uuid)`);
  await closeDb();
});

const code = new URLSearchParams({ code: "the-code", state: "s" });

describe("a store's Facebook Page", () => {
  it("connects the person's one Page at once, reads its posts' figures daily, and shows them", async () => {
    expect(await fb.facebookView(one.id)).toEqual({ state: "none" });
    expect(await fb.connectFacebook(one.account.id, one.id, code)).toEqual({ choose: [] });
    const [kept] = await db().execute<{ page_id: string; user: string | null; token: string }>(
      sql`select page_id, user_token_encrypted as user, page_token_encrypted as token from commerce.facebook_pages where store_id = ${one.id}::uuid`,
    );
    expect(kept.page_id).toBe("5550001");
    expect(kept.user).toBeNull();
    // Kept encrypted, never as Facebook gave it.
    expect(kept.token).not.toContain("page-token");
    expect(await fb.facebookView(one.id)).toEqual({ state: "waiting", name: "Keramikk" });

    const run = await fb.refreshFacebookInsights(NOW, 1000);
    expect(run.failed).toBe(0);
    const view = await fb.facebookView(one.id);
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    // The post older than 90 days is left out.
    expect(view.posts).toHaveLength(1);
    expect(view.posts[0]).toMatchObject({ mediaId: "5550001_1", caption: "New bowls", figures: { reach: 640, views: 900, likes: 20, comments: 3, shares: 2, interactions: 25, saves: null } });

    // Read once a day: a second run the same day asks nothing of this Page.
    asked.length = 0;
    await fb.refreshFacebookInsights(NOW, 1000);
    expect(asked.filter((p) => p.includes("5550001"))).toEqual([]);
  });

  it("keeps several Pages to choose among, without their tokens, then keeps only the one chosen", async () => {
    pageCount = 2;
    insightsAllowed = false;
    const { choose } = await fb.connectFacebook(two.account.id, two.id, code);
    expect(choose.map((c) => c.id)).toEqual(["5550001", "5550002"]);
    const [row] = await db().execute<{ choices: string }>(sql`select choices::text as choices from commerce.facebook_pages where store_id = ${two.id}::uuid`);
    expect(row.choices).not.toContain("token");
    expect(await fb.facebookView(two.id)).toMatchObject({ state: "choose" });
    expect(await fb.chooseFacebookPage(two.account.id, two.id, "9999999")).toBe(false);
    expect(await fb.chooseFacebookPage(two.account.id, two.id, "5550002")).toBe(true);
    expect(await fb.facebookView(two.id)).toEqual({ state: "waiting", name: "Other shop" });
    // Without read_insights no reach is asked for.
    asked.length = 0;
    await fb.refreshFacebookInsights(NOW, 1000);
    expect(asked.some((p) => p.endsWith("/insights"))).toBe(false);
    const view = await fb.facebookView(two.id);
    expect(view.state === "ready" && view.insights).toBe(false);
  });

  it("disconnects: the Page, its tokens and its posts' figures go", async () => {
    await fb.disconnectFacebook(one.account.id, one.id);
    expect(await fb.facebookView(one.id)).toEqual({ state: "none" });
    const [left] = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.social_post_insights where store_id = ${one.id}::uuid and channel = 'facebook'`);
    expect(Number(left.n)).toBe(0);
  });
});
