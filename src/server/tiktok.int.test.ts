import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.TIKTOK_CLIENT_KEY = "awtestkey";
process.env.TIKTOK_CLIENT_SECRET = "tiktok-test-secret";

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { connectTiktok, disconnectTiktok, tiktokTarget, tiktokView } = await import("./tiktok");
const { publishSocialPost, publishTargets } = await import("./social-publish");

/**
 * TikTok (D870 S3.5), with TikTok scripted: connecting keeps the tokens encrypted and reads the account's name, an approved TikTok post goes
 * out as its video uploaded in one piece and private until the app is audited, a post without a video is refused, and the day-long token is
 * renewed before it is used. Nothing reaches TikTok.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const calls: { path: string; body: string }[] = [];
let renewals = 0;
let uploaded = 0;
const tiktok = (async (path: string, init?: RequestInit) => {
  calls.push({ path, body: String(init?.body ?? "") });
  if (path === "/oauth/token/") {
    if (new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token") renewals += 1;
    return { access_token: `act.${renewals}`, refresh_token: "rft.1", open_id: "-000shop", expires_in: 86400, refresh_expires_in: 31536000, scope: "user.info.basic,video.publish" };
  }
  if (path === "/post/publish/creator_info/query/") return { data: { creator_username: "theshop", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }, error: { code: "ok" } };
  if (path === "/post/publish/video/init/") return { data: { publish_id: "v_pub_file~v2.1", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1" }, error: { code: "ok" } };
  if (path === "/post/publish/status/fetch/") return { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] }, error: { code: "ok" } };
  throw new Error(`unexpected ${path}`);
}) as never;
const deps = { tiktok, videoBytes: async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), upload: async () => ((uploaded += 1), true), wait: async () => {} };

beforeAll(async () => {
  store = await makeStore("tiktok");
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.media where store_id = ${store.id}::uuid and file_name = 'tiktok-test.mp4'`);
  await db().execute(sql`delete from commerce.tiktok_accounts where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("TikTok", () => {
  it("connects, and posts an approved post's video privately, refusing one without a video", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    expect(await connectTiktok(store.account.id, store.id, new URLSearchParams({ code: "abc" }), tiktok)).toEqual({ choose: [] });
    const [row] = await db().execute<{ access: string }>(sql`select access_token_encrypted as access from commerce.tiktok_accounts where store_id = ${store.id}::uuid`);
    expect(row.access).not.toContain("act.");
    expect(await tiktokView(store.id)).toEqual({ state: "ready", username: "theshop", publish: true, problem: null });
    expect((await publishTargets(member.store)).tiktok).toBe(true);

    const insert = async (ref: string, video: string | null) =>
      String(
        (
          await db().execute<{ id: string }>(sql`
            insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, hashtags, link, approved_at, video_media_id)
            values (${store.id}::uuid, 'tiktok', ${ref}, 'Bowls', 'en-GB', 'A morning at the wheel.', '{ceramics}', 'https://example.com', now(), ${video}::uuid) returning id`)
        )[0].id,
      );
    const without = await insert("tiktoknovide", null);
    expect(await publishSocialPost(member, without, "https://example.com", deps)).toEqual({ ok: false, problem: "A TikTok post goes out as its video: make the video first." });

    const [media] = await db().execute<{ id: string }>(sql`
      insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes)
      values (${store.id}::uuid, 'video', 'https://example.com/v.mp4', 'page-videos', ${`${store.id}/tiktok-test.mp4`}, 'tiktok-test.mp4', 'video/mp4', 8) returning id`);
    const post = await insert("tiktokvideoa", String(media.id));
    expect(await publishSocialPost(member, post, "https://example.com", deps)).toEqual({ ok: true, url: null });
    expect(uploaded).toBe(1);
    const init = JSON.parse(calls.find((c) => c.path === "/post/publish/video/init/")!.body);
    expect(init.post_info).toMatchObject({ privacy_level: "SELF_ONLY", title: expect.stringContaining("A morning at the wheel.") });
    expect(init.source_info).toEqual({ source: "FILE_UPLOAD", video_size: 8, chunk_size: 8, total_chunk_count: 1 });
    const [out] = await db().execute<{ published_id: string }>(sql`select published_id from commerce.social_posts where id = ${post}::uuid`);
    expect(out.published_id).toBe("v_pub_file~v2.1");
  });

  it("renews the day-long token before it ends", async () => {
    await db().execute(sql`update commerce.tiktok_accounts set token_expires_at = now() + interval '10 minutes' where store_id = ${store.id}::uuid`);
    expect(await tiktokTarget(store.id, new Date(), tiktok)).toEqual({ username: "theshop", token: "act.1" });
    expect(renewals).toBe(1);
  });

  it("disconnects", async () => {
    await disconnectTiktok(store.account.id, store.id);
    expect(await tiktokView(store.id)).toEqual({ state: "none" });
  });
});
