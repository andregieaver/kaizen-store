import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { keepSlideshow, slideshowPlan } = await import("./social-slideshow");

/**
 * A post's slideshow video (D870 S2.5): the photos the browser draws (the post's own picture first, then the product's other photos, by this
 * page's own addresses) and the made video kept on the post once its upload is in the library. Another store's video is never taken.
 */

type Store = Awaited<ReturnType<typeof makeStore>>;
let store: Store;
let other: Store;
let post: string;
let productId: string;

beforeAll(async () => {
  [store, other] = await Promise.all([makeStore("slideshow"), makeStore("slideshow-other")]);
  const [product] = await db().execute<{ id: string }>(sql`
    insert into commerce.products (store_id, handle, tax_code, kind) values (${store.id}::uuid, ${`bowl-${Date.now()}`}, 'txcd_99999999', 'goods') returning id`);
  productId = String(product.id);
  for (const [i, url] of ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"].entries()) {
    await db().execute(sql`insert into commerce.product_media (store_id, product_id, url, kind, position) values (${store.id}::uuid, ${productId}::uuid, ${url}, 'image', ${i})`);
  }
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.social_posts (store_id, channel, ref, product_id, locale, caption, link, planned_for)
    values (${store.id}::uuid, 'tiktok', 'slideshowaaa', ${productId}::uuid, 'en-GB', 'A bowl on the wheel.', 'https://example.com', '2026-11-28') returning id`);
  post = String(row.id);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.media where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await closeDb();
});

const video = async (owner: Store, path: string) =>
  db().execute(sql`insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, created_by)
    values (${owner.id}::uuid, 'video', ${`https://example.com/${path}`}, 'page-videos', ${path}, 'post.mp4', 'video/mp4', 1000, ${owner.account.id}::uuid)`);

describe("a post's slideshow video", () => {
  it("draws the post's own picture first, then the product's photos after its first, by this page's own addresses", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const plan = await slideshowPlan(member, post, "/admin/x/social");
    expect(plan).toMatchObject({ ok: true, name: "post-slideshowaaa" });
    if (!plan.ok) return;
    expect(plan.photos[0]).toMatch(new RegExp(`^/admin/x/social/picture/${post}\\?v=`));
    expect(plan.photos.slice(1)).toEqual([`/admin/x/social/slides/${post}?n=1`, `/admin/x/social/slides/${post}?n=2`]);
    expect(await slideshowPlan(member, "00000000-0000-4000-8000-000000000000", "/x")).toEqual({ ok: false });
  });

  it("keeps the uploaded video on the post, and never another store's", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    await video(other, `${other.id}/theirs.mp4`);
    expect(await keepSlideshow(member, post, `${other.id}/theirs.mp4`)).toMatchObject({ ok: false });
    await video(store, `${store.id}/mine.mp4`);
    expect(await keepSlideshow(member, post, `${store.id}/mine.mp4`)).toEqual({ ok: true, url: `https://example.com/${store.id}/mine.mp4` });
    const [row] = await db().execute<{ has: boolean }>(sql`select video_media_id is not null as has from commerce.social_posts where id = ${post}::uuid`);
    expect(row.has).toBe(true);
  });
});
