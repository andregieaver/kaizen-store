import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { publishSocialPost } = await import("./social-publish");
const { setPostFormat } = await import("./social-calendar");

/**
 * A post's carousel and Story (D870 S2.1b), with Instagram's and Facebook's APIs scripted (nothing reaches Meta): only a product's post may
 * be a carousel and only Instagram and Facebook send a Story; changing either takes back the yes; a carousel goes out as one container per
 * picture and the carousel's own, or the Page's photos in one post; the Story follows, and one that fails leaves the post out with why.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let productId = "";
const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
const calls: string[] = [];
let storyFails = false;

const answer = async (url: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const u = new URL(url);
  const body = new URLSearchParams(String(init?.body ?? ""));
  calls.push(`${init?.method ?? "GET"} ${u.pathname}${body.get("media_type") ? ` ${body.get("media_type")}` : ""}${body.get("is_carousel_item") ? " item" : ""}`);
  if (storyFails && body.get("media_type") === "STORIES") throw new (await import("./instagram")).InstagramError("Instagram said: stories are off");
  if (u.pathname.endsWith("/media") && init?.method === "POST") return { id: String(17890000000000100 + calls.length) };
  if (u.pathname.endsWith("/media_publish")) return { id: "17890000000000002" };
  if (u.searchParams.get("fields") === "status_code") return { status_code: "FINISHED" };
  if (u.searchParams.get("fields") === "permalink") return { permalink: "https://www.instagram.com/p/abc/" };
  if (u.pathname.endsWith("/photos")) return { id: String(555 + calls.length) };
  if (u.pathname.endsWith("/feed")) return { id: "5550001_888" };
  if (u.pathname.endsWith("/photo_stories")) return { success: true, post_id: "5550001_999" };
  if (u.searchParams.get("fields") === "permalink_url") return { permalink_url: "https://www.facebook.com/5550001/posts/888" };
  return {};
};
const pictures: string[] = [];
const deps = {
  instagram: answer as never,
  facebook: answer as never,
  picture: async (_m: unknown, _p: unknown, _o: string, options?: { slide?: number; story?: boolean }) => {
    const name = options?.story ? "story" : `slide-${options?.slide ?? 0}`;
    pictures.push(name);
    return `https://example.com/${name}.jpg`;
  },
  wait: async () => {},
};

const post = async (ref: string, channel: string, withProduct = true) => {
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, hashtags, link, product_id, approved_at)
    values (${store.id}::uuid, ${channel}, ${ref}, 'Bowls', 'en-GB', 'Glazed in small batches.', '{ceramics}', 'https://example.com', ${withProduct ? productId : null}::uuid, now()) returning id`);
  return String(row.id);
};
const approve = (id: string) => db().execute(sql`update commerce.social_posts set approved_at = now() where id = ${id}::uuid`);

beforeAll(async () => {
  store = await makeStore("social-formats");
  const [product] = await db().execute<{ id: string }>(sql`
    insert into commerce.products (store_id, handle, tax_code, status) values (${store.id}::uuid, 'formats-bowl', 'txcd_99999999', 'draft') returning id`);
  productId = String(product.id);
  for (const position of [0, 1, 2]) {
    await db().execute(sql`insert into commerce.product_media (store_id, product_id, url, position) values (${store.id}::uuid, ${productId}::uuid, ${`https://example.com/bowl-${position}.jpg`}, ${position})`);
  }
  await db().execute(sql`
    insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, publish)
    values (${store.id}::uuid, '17841400000000039', 'shop', ${encryptSecret("ig-token", key)}, now() + interval '50 days', true)`);
  await db().execute(sql`
    insert into commerce.facebook_pages (store_id, page_id, page_name, page_token_encrypted, publish)
    values (${store.id}::uuid, '5550001', 'The Shop', ${encryptSecret("page-token", key)}, true)`);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  if (productId) await db().execute(sql`delete from commerce.product_media where store_id = ${store.id}::uuid and product_id = ${productId}::uuid`);
  await db().execute(sql`delete from commerce.products where store_id = ${store.id}::uuid and handle = 'formats-bowl'`);
  await db().execute(sql`delete from commerce.instagram_accounts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.facebook_pages where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("a post's carousel and Story", () => {
  it("lets only a product's post be a carousel, a Story only on Instagram and Facebook, and takes back the yes", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const topic = await post("formatstopic", "instagram", false);
    expect(await setPostFormat(member, { id: topic, carousel: true })).toMatchObject({ ok: false });
    const pin = await post("formatspinaa", "pinterest");
    expect(await setPostFormat(member, { id: pin, story: true })).toMatchObject({ ok: false });
    expect(await setPostFormat(member, { id: pin, carousel: true })).toEqual({ ok: true });
    const [row] = await db().execute<{ carousel: boolean; approved_at: string | null }>(sql`select carousel, approved_at from commerce.social_posts where id = ${pin}::uuid`);
    expect(row).toEqual({ carousel: true, approved_at: null });
  });

  it("posts an Instagram carousel of four pictures, then its Story", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const id = await post("formatsigaaa", "instagram");
    await setPostFormat(member, { id, carousel: true, story: true });
    await approve(id);
    calls.length = 0;
    pictures.length = 0;
    expect(await publishSocialPost(member, id, "https://example.com", deps)).toEqual({ ok: true, url: "https://www.instagram.com/p/abc/" });
    // The drawn picture, the product's two other photos, the closing slide; then the Story's frame.
    expect(pictures).toEqual(["slide-0", "slide-1", "slide-2", "slide-3", "story"]);
    const made = calls.filter((c) => c.startsWith("POST") && c.includes("/media") && !c.includes("publish"));
    expect(made).toEqual([
      "POST /v24.0/17841400000000039/media item",
      "POST /v24.0/17841400000000039/media item",
      "POST /v24.0/17841400000000039/media item",
      "POST /v24.0/17841400000000039/media item",
      "POST /v24.0/17841400000000039/media CAROUSEL",
      "POST /v24.0/17841400000000039/media STORIES",
    ]);
  });

  it("posts a Facebook carousel as the Page's photos in one post, and keeps it out when only its Story fails", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const id = await post("formatsfbaaa", "facebook");
    await setPostFormat(member, { id, carousel: true, story: true });
    await approve(id);
    calls.length = 0;
    expect(await publishSocialPost(member, id, "https://example.com", deps)).toEqual({ ok: true, url: "https://www.facebook.com/5550001/posts/888" });
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
      "POST /v24.0/5550001/photos",
      "POST /v24.0/5550001/photos",
      "POST /v24.0/5550001/photos",
      "POST /v24.0/5550001/photos",
      "POST /v24.0/5550001/feed",
      "POST /v24.0/5550001/photos",
      "POST /v24.0/5550001/photo_stories",
    ]);

    storyFails = true;
    const ig = await post("formatsigbbb", "instagram");
    await setPostFormat(member, { id: ig, story: true });
    await approve(ig);
    expect(await publishSocialPost(member, ig, "https://example.com", deps)).toMatchObject({ ok: true });
    const [row] = await db().execute<{ published_at: string | null; publish_problem: string | null }>(sql`select published_at, publish_problem from commerce.social_posts where id = ${ig}::uuid`);
    expect(row.published_at).not.toBeNull();
    expect(row.publish_problem).toContain("the Story was not");
    storyFails = false;
  });
});
