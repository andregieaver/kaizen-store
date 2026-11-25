import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { refreshSocialInsights, insightsView } = await import("./social-insights");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");

/**
 * How a connected Instagram account's posts did (D870 S1.2): the daily run against a stand-in for Instagram's API (`fetch` replaced), kept
 * in `social_post_insights` and read back for the owner. A store made for the test.
 */

const run = Date.now().toString(36);
const NOW = new Date("2026-11-25T12:00:00Z");
let storeId: string;
let accountId: string;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Instagram as the test sees it: two recent posts and one too old; a story refuses `likes`; a token named "bad" is refused. */
function instagram(asked: string[]) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    asked.push(url.pathname);
    if (url.searchParams.get("access_token") === "bad") return json({ error: { message: "Error validating access token" } }, 400);
    if (url.pathname.endsWith("/me/media")) {
      return json({
        data: [
          { id: "1001", caption: "New mugs", media_type: "IMAGE", media_product_type: "FEED", permalink: "https://www.instagram.com/p/a/", timestamp: "2026-11-20T10:00:00+0000" },
          { id: "1002", caption: "", media_type: "VIDEO", media_product_type: "STORY", permalink: "", timestamp: "2026-11-18T10:00:00+0000" },
          { id: "1003", caption: "Old", media_type: "IMAGE", media_product_type: "FEED", permalink: "", timestamp: "2026-07-01T10:00:00+0000" },
        ],
      });
    }
    if (url.pathname.endsWith("/1001/insights")) {
      return json({ data: [{ name: "reach", values: [{ value: 1200 }] }, { name: "likes", values: [{ value: 80 }] }, { name: "saved", values: [{ value: 14 }] }] });
    }
    if (url.pathname.endsWith("/1002/insights")) {
      if (url.searchParams.get("metric")?.includes("likes")) return json({ error: { message: "metric likes is not supported for STORY" } }, 400);
      return json({ data: [{ name: "reach", values: [{ value: 300 }] }] });
    }
    return json({ error: { message: "unknown" } }, 404);
  });
}

beforeAll(async () => {
  const slug = `insights-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  storeId = String(created.id);
}, 60_000);

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await db().execute(sql`delete from commerce.instagram_accounts where store_id = ${storeId}::uuid`);
  await closeDb();
});

async function connect(token: string, insights: boolean) {
  await db().execute(sql`delete from commerce.instagram_accounts where store_id = ${storeId}::uuid`);
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, insights)
    values (${storeId}::uuid, '17841400000000000', 'keramikk', ${encryptSecret(token, key)}, now() + interval '30 days', ${insights}) returning id`);
  accountId = String(row.id);
}

describe("an Instagram account's posts' figures", () => {
  it("asks the owner to connect again while the token lacks the permission, and reads nothing", async () => {
    await connect("good", false);
    const asked: string[] = [];
    vi.stubGlobal("fetch", instagram(asked));
    expect(await insightsView(storeId)).toEqual({ state: "reconnect", username: "keramikk" });
    await refreshSocialInsights(NOW);
    expect(asked).toEqual([]);
  });

  it("keeps the last 90 days' posts with their totals, a story with what a story has, and shows them newest first", async () => {
    await connect("good", true);
    expect(await insightsView(storeId)).toEqual({ state: "waiting", username: "keramikk" });
    vi.stubGlobal("fetch", instagram([]));
    const outcome = await refreshSocialInsights(NOW);
    expect(outcome).toMatchObject({ read: 1, posts: 2, failed: 0 });
    const kept = await db().execute<Row>(sql`select media_id, kind, reach, likes, saves from commerce.social_post_insights where account_id = ${accountId}::uuid order by media_id`);
    expect(kept.map((r) => [r.media_id, r.kind, r.reach, r.likes, r.saves])).toEqual([
      ["1001", "feed", 1200, 80, 14],
      ["1002", "story", 300, null, null],
    ]);
    // Read once a day: the same day's run asks nothing.
    const asked: string[] = [];
    vi.stubGlobal("fetch", instagram(asked));
    await refreshSocialInsights(new Date(NOW.getTime() + 3_600_000));
    expect(asked).toEqual([]);
    const view = await insightsView(storeId);
    expect(view.state).toBe("ready");
    if (view.state === "ready") expect(view.posts.map((p) => p.mediaId)).toEqual(["1001", "1002"]);
  });

  it("keeps Instagram's refusal as the account's problem, and the figures already read", async () => {
    await db().execute(sql`update commerce.instagram_accounts set token_encrypted = ${encryptSecret("bad", parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!)}, insights_fetched_at = null where id = ${accountId}::uuid`);
    vi.stubGlobal("fetch", instagram([]));
    expect(await refreshSocialInsights(NOW)).toMatchObject({ read: 0, failed: 1 });
    const view = await insightsView(storeId);
    expect(view.state === "ready" && view.problem).toBe("Instagram said: Error validating access token");
    expect(view.state === "ready" && view.posts.length).toBe(2);
  });
});
