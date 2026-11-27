import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.FACEBOOK_APP_ID = "1234";
process.env.FACEBOOK_APP_SECRET = "app-secret";
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const fb = await import("./facebook-pages");
const { refreshInstagramFeeds, instagramStatus } = await import("./instagram");
const { publishSocialPost } = await import("./social-publish");

/**
 * Instagram through the Facebook Page it is linked to (D870, Meta's unified login, the only one newer apps have), with Meta scripted (nothing
 * reaches it): connecting the Page connects its Instagram business account with the Page's token; its feed is read and its posts published
 * on `graph.facebook.com` by the account's id; an account connected with Instagram Login stays; disconnecting the Page takes it away.
 */

type Store = Awaited<ReturnType<typeof makeStore>>;
let one: Store;
let two: Store;
const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
const asked: string[] = [];

function answer(url: URL): unknown {
  const path = url.pathname.replace("/v24.0", "");
  if (path === "/oauth/access_token") return { access_token: url.searchParams.get("grant_type") ? "long-user-token" : "short-user-token" };
  if (path === "/me/accounts") return { data: [{ id: "5550001", name: "Keramikk", access_token: "page-token-1" }] };
  if (path === "/me/permissions") {
    return { data: ["pages_show_list", "instagram_basic", "instagram_manage_insights", "instagram_content_publish"].map((permission) => ({ permission, status: "granted" })) };
  }
  if (path === "/5550001") return { instagram_business_account: { id: "17841400000000077", username: "keramikk" }, id: "5550001" };
  if (path === "/17841400000000077/media" && !url.searchParams.has("image_url")) {
    return { data: [{ id: "17900000000000001", caption: "Bowls", media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/a.jpg", permalink: "https://www.instagram.com/p/x/", timestamp: "2026-11-20T10:00:00+0000" }] };
  }
  return { __status: 404, error: { message: "Unknown path" } };
}

beforeAll(async () => {
  [one, two] = await Promise.all([makeStore("igfb-one"), makeStore("igfb-two")]);
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    asked.push(`${url.host}${url.pathname}`);
    const body = answer(url) as { __status?: number };
    return new Response(JSON.stringify(body), { status: body.__status ?? 200, headers: { "content-type": "application/json" } });
  });
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await db().execute(sql`delete from commerce.social_posts where store_id in (${one.id}::uuid, ${two.id}::uuid)`);
  await db().execute(sql`delete from commerce.instagram_accounts where store_id in (${one.id}::uuid, ${two.id}::uuid)`);
  await db().execute(sql`delete from commerce.facebook_pages where store_id in (${one.id}::uuid, ${two.id}::uuid)`);
  await closeDb();
});

const code = new URLSearchParams({ code: "the-code", state: "s" });

describe("Instagram through the Facebook Page", () => {
  it("connects the Page's Instagram account with the Page's token, and reads its feed on Facebook's API", async () => {
    await fb.connectFacebook(one.account.id, one.id, code);
    const [row] = await db().execute<{ ig_user_id: string; username: string; via: string; insights: boolean; publish: boolean; token: string }>(sql`
      select ig_user_id, username, via, insights, publish, token_encrypted as token from commerce.instagram_accounts where store_id = ${one.id}::uuid`);
    expect(row).toMatchObject({ ig_user_id: "17841400000000077", username: "keramikk", via: "facebook", insights: true, publish: true });
    expect(row.token).not.toContain("page-token");

    asked.length = 0;
    await refreshInstagramFeeds(new Date(), 50);
    expect(asked).toContain("graph.facebook.com/v24.0/17841400000000077/media");
    expect(asked.some((a) => a.startsWith("graph.instagram.com"))).toBe(false);
    expect(await instagramStatus(one.id)).toMatchObject({ username: "keramikk", via: "facebook", posts: 1 });
  });

  it("publishes to that account on Facebook's API, by its id", async () => {
    const member = (await passMembership(one.slug, one.account.id))!;
    const [post] = await db().execute<{ id: string }>(sql`
      insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, hashtags, link, approved_at)
      values (${one.id}::uuid, 'instagram', 'igfbpostaaaa', 'Bowls', 'en-GB', 'Glazed.', '{}', 'https://example.com', now()) returning id`);
    const urls: string[] = [];
    const instagram = (async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith("/media")) return { id: "17890000000000301" };
      if (u.pathname.endsWith("/media_publish")) return { id: "17890000000000302" };
      if (u.searchParams.get("fields") === "status_code") return { status_code: "FINISHED" };
      return { permalink: "https://www.instagram.com/p/igfb/" };
    }) as never;
    expect(await publishSocialPost(member, String(post.id), "https://example.com", { instagram, picture: async () => "https://example.com/p.jpg", wait: async () => {} })).toEqual({
      ok: true,
      url: "https://www.instagram.com/p/igfb/",
    });
    expect(urls[0]).toMatch(/^https:\/\/graph\.facebook\.com\/v24\.0\/17841400000000077\/media$/);
  });

  it("leaves an account connected with Instagram Login as it is, and takes the Page's away with the Page", async () => {
    await db().execute(sql`
      insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, via)
      values (${two.id}::uuid, '17841400000000099', 'ownlogin', ${encryptSecret("ig-token", key)}, now() + interval '50 days', 'instagram')`);
    await fb.connectFacebook(two.account.id, two.id, code);
    const [kept] = await db().execute<{ username: string; via: string }>(sql`select username, via from commerce.instagram_accounts where store_id = ${two.id}::uuid`);
    expect(kept).toEqual({ username: "ownlogin", via: "instagram" });

    await fb.disconnectFacebook(one.account.id, one.id);
    expect(await instagramStatus(one.id)).toBeNull();
    await fb.disconnectFacebook(two.account.id, two.id);
    expect(await instagramStatus(two.id)).toMatchObject({ username: "ownlogin" });
  });
});
