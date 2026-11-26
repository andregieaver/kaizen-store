import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { publishSocialPost, publishTargets } = await import("./social-publish");
const { editSocialPost, approveSocialPosts } = await import("./social-calendar");

/**
 * Publishing an approved post (D870 S3.1), with Instagram's and Facebook's APIs scripted (nothing reaches Meta): only an approved post, only
 * where the connection allows posting, once, with Meta's id and address kept; a refusal kept in Meta's words; a published post's words and
 * yes no longer change.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
const calls: string[] = [];

const answer = async (url: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const u = new URL(url);
  calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
  if (u.pathname.endsWith("/media") && init?.method === "POST") return { id: "17890000000000001" };
  if (u.pathname.endsWith("/media_publish")) return { id: "17890000000000002" };
  if (u.searchParams.get("fields") === "status_code") return { status_code: "FINISHED" };
  if (u.searchParams.get("fields") === "permalink") return { permalink: "https://www.instagram.com/p/abc/" };
  if (u.pathname.endsWith("/photos")) return { id: "555", post_id: "5550001_777" };
  if (u.searchParams.get("fields") === "permalink_url") return { permalink_url: "https://www.facebook.com/5550001/posts/777" };
  return {};
};
const deps = { instagram: answer as never, facebook: answer as never, picture: async () => "https://example.com/post.jpg", wait: async () => {} };

const post = async (ref: string, channel: string, approved: boolean) => {
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, hashtags, link, approved_at)
    values (${store.id}::uuid, ${channel}, ${ref}, 'The workshop', 'en-GB', 'A morning in the workshop.', '{ceramics}', 'https://example.com', ${approved ? sql`now()` : null}) returning id`);
  return String(row.id);
};

beforeAll(async () => {
  store = await makeStore("social-publish");
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.instagram_accounts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.facebook_pages where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("publishing an approved social post", () => {
  it("asks for a connection that allows posting, and an approved post", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const ig = await post("publishigaaa", "instagram", true);
    expect(await publishTargets(member.store)).toEqual({ instagram: false, facebook: false, pinterest: false });
    expect(await publishSocialPost(member, ig, "https://example.com", deps)).toMatchObject({ ok: false, problem: expect.stringContaining("Connect the store's Instagram") });
    await db().execute(sql`
      insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, publish)
      values (${store.id}::uuid, '17841400000000009', 'shop', ${encryptSecret("ig-token", key)}, now() + interval '50 days', false)`);
    expect(await publishSocialPost(member, ig, "https://example.com", deps)).toMatchObject({ ok: false, problem: expect.stringContaining("allow publishing") });
    await db().execute(sql`update commerce.instagram_accounts set publish = true where store_id = ${store.id}::uuid`);
    expect(await publishTargets(member.store)).toEqual({ instagram: true, facebook: false, pinterest: false });
    const draft = await post("publishdraft", "instagram", false);
    expect(await publishSocialPost(member, draft, "https://example.com", deps)).toMatchObject({ ok: false, problem: "Approve the post before it is published." });
    // Pinterest is published to from S3.4, once connected; LinkedIn is still copied by hand.
    const pin = await post("publishpinaa", "pinterest", true);
    expect(await publishSocialPost(member, pin, "https://example.com", deps)).toMatchObject({ ok: false, problem: expect.stringContaining("Connect the store's Pinterest") });
    const linkedin = await post("publishlinka", "linkedin", true);
    expect(await publishSocialPost(member, linkedin, "https://example.com", deps)).toMatchObject({ ok: false, problem: expect.stringContaining("copy the post") });
  });

  it("publishes to Instagram once: container, published, permalink kept, and never twice", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const [{ id }] = await db().execute<{ id: string }>(sql`select id from commerce.social_posts where store_id = ${store.id}::uuid and ref = 'publishigaaa'`);
    calls.length = 0;
    expect(await publishSocialPost(member, id, "https://example.com", deps)).toEqual({ ok: true, url: "https://www.instagram.com/p/abc/" });
    expect(calls).toEqual(["POST /v24.0/17841400000000009/media", "GET /v24.0/17890000000000001", "POST /v24.0/17841400000000009/media_publish", "GET /v24.0/17890000000000002"]);
    const [row] = await db().execute<{ published_id: string; published_url: string; published_by: string }>(
      sql`select published_id, published_url, published_by from commerce.social_posts where id = ${id}::uuid`,
    );
    expect(row).toEqual({ published_id: "17890000000000002", published_url: "https://www.instagram.com/p/abc/", published_by: store.account.id });
    expect(await publishSocialPost(member, id, "https://example.com", deps)).toEqual({ ok: false, problem: "This post is published already." });
    // Its words and its yes stay as they went out.
    expect(await editSocialPost(member, { id, caption: "Changed." })).toMatchObject({ ok: false });
    expect(await approveSocialPosts(member, [id], false)).toEqual({ ok: true, changed: 0 });
  });

  it("publishes a photo to the Facebook Page, and keeps a refusal in Facebook's words", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    await db().execute(sql`
      insert into commerce.facebook_pages (store_id, page_id, page_name, page_token_encrypted, publish)
      values (${store.id}::uuid, '5550001', 'Shop', ${encryptSecret("page-token", key)}, true)`);
    const fb = await post("publishfbaaa", "facebook", true);
    expect(await publishSocialPost(member, fb, "https://example.com", deps)).toEqual({ ok: true, url: "https://www.facebook.com/5550001/posts/777" });

    const refused = await post("publishfbbbb", "facebook", true);
    const { FacebookError } = await import("./facebook-pages");
    const failing = { ...deps, facebook: (async () => { throw new FacebookError("Facebook said: (#200) The user hasn't authorized the application to perform this action"); }) as never };
    expect(await publishSocialPost(member, refused, "https://example.com", failing)).toMatchObject({ ok: false, problem: expect.stringContaining("(#200)") });
    const [row] = await db().execute<{ publish_problem: string; published_at: string | null; publish_started_at: string | null }>(
      sql`select publish_problem, published_at, publish_started_at from commerce.social_posts where id = ${refused}::uuid`,
    );
    expect(row.publish_problem).toContain("(#200)");
    expect(row.published_at).toBeNull();
    // The claim is let go, so the owner may try again.
    expect(row.publish_started_at).toBeNull();
  });
});
