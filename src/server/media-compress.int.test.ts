import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { replaceVideo, rewriteAddresses } = await import("./media-compress");
const { compressibleCount, compressibleMedia, mediaUses } = await import("./media-library");
const { makeStore, run } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * Compress (D213) moves every editable place from a file's old address to the smaller file's, in the owner's site only:
 * the pages (drafts and published), menus, products' pictures, the site's settings and CSS, custom field values and
 * categories' sharing pictures.
 */
describe("moving a compressed file's uses to its new address (D213)", () => {
  const base = `https://storage.test/storage/v1/object/public/product-media/${run}`;
  const oldUrl = `${base}/old.webp`;
  const oldThumb = `${base}/old-480.webp`;
  const newUrl = `${base}/new.avif`;
  const newThumb = `${base}/new-480.webp`;
  const pairs: [string, string][] = [
    [oldUrl, newUrl],
    [oldThumb, newThumb],
  ];

  const page = (url: string) => ({ title: "Bilder", slug: "bilder", rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "b1", type: "image", url, thumbnail: oldThumb }] }] }] });

  async function arrange() {
    const store = await makeStore("komprimert");
    const other = await makeStore("annen");
    for (const owner of [store, other]) {
      await db().execute(sql`
        insert into commerce.pages (store_id, slug, draft, published, published_at)
        values (${owner.id}::uuid, ${`bilder-${run}`}, ${JSON.stringify(page(oldUrl))}::jsonb, ${JSON.stringify(page(oldUrl))}::jsonb, now())
      `);
    }
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.id}::uuid limit 1`);
    await db().execute(sql`
      insert into commerce.product_media (store_id, product_id, url, thumbnail_url) values (${store.id}::uuid, ${String(product.id)}::uuid, ${oldUrl}, ${oldThumb})
    `);
    await db().execute(sql`insert into commerce.menus (store_id, name, items) values (${store.id}::uuid, 'Meny', ${JSON.stringify([{ label: "Bilde", image: oldUrl }])}::jsonb)`);
    await db().execute(sql`
      update commerce.stores set custom_css = ${`.hero { background: url(${oldUrl}); }`}, seo = jsonb_set(coalesce(seo, '{}'::jsonb), '{image}', to_jsonb(${oldUrl}::text))
      where id = ${store.id}::uuid
    `);
    return { store, other };
  }

  async function rewrite(storeId: string) {
    await db().transaction(async (tx) => {
      for (const statement of rewriteAddresses(storeId, pairs)) await tx.execute(statement);
    });
  }

  it("moves every place in the store, the small copy with it", async () => {
    const { store } = await arrange();
    await rewrite(store.id);
    const [pageRow] = await db().execute<Row>(sql`select draft::text as draft, published::text as published from commerce.pages where store_id = ${store.id}::uuid and slug = ${`bilder-${run}`}`);
    for (const text of [String(pageRow.draft), String(pageRow.published)]) {
      expect(text).toContain(newUrl);
      expect(text).toContain(newThumb);
      expect(text).not.toContain(oldUrl);
      expect(text).not.toContain(oldThumb);
    }
    const [media] = await db().execute<Row>(sql`select url, thumbnail_url from commerce.product_media where store_id = ${store.id}::uuid and url = ${newUrl}`);
    expect(media?.thumbnail_url).toBe(newThumb);
    const [menu] = await db().execute<Row>(sql`select items::text as items from commerce.menus where store_id = ${store.id}::uuid and name = 'Meny'`);
    expect(String(menu.items)).toContain(newUrl);
    const [settings] = await db().execute<Row>(sql`select custom_css, seo ->> 'image' as image from commerce.stores where id = ${store.id}::uuid`);
    expect(settings.custom_css).toBe(`.hero { background: url(${newUrl}); }`);
    expect(settings.image).toBe(newUrl);
  });

  it("leaves another store's pages as they are", async () => {
    const { store, other } = await arrange();
    await rewrite(store.id);
    const [pageRow] = await db().execute<Row>(sql`select draft::text as draft from commerce.pages where store_id = ${other.id}::uuid and slug = ${`bilder-${run}`}`);
    expect(String(pageRow.draft)).toContain(oldUrl);
    expect(String(pageRow.draft)).not.toContain(newUrl);
  });

  it("finds the uses it moves, with what kind of place each is", async () => {
    const { store } = await arrange();
    const [row] = await db().execute<Row>(sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, file_name, content_type, size_bytes)
      values (${store.id}::uuid, 'image', ${oldUrl}, ${oldThumb}, 'product-media', ${`${store.id}/old.webp`}, 'old.webp', 'image/webp', 900000)
      returning id
    `);
    const owner = { storeId: store.id, storeSlug: store.slug };
    const uses = (await mediaUses(owner, [String(row.id)])).get(String(row.id)) ?? [];
    expect(new Set(uses.map((use) => use.source))).toEqual(new Set(["page", "product", "menu", "seo"]));
    expect(await compressibleCount(owner)).toBeGreaterThanOrEqual(1);
    expect((await compressibleMedia(owner)).map((item) => item.id)).toContain(String(row.id));
    await db().execute(sql`update commerce.media set compressed_at = now() where id = ${String(row.id)}::uuid`);
    expect((await compressibleMedia(owner)).map((item) => item.id)).not.toContain(String(row.id));
  });

  it("never takes another library video as a replacement, so its file is neither moved nor removed", async () => {
    const store = await makeStore("videoer");
    const video = async (name: string) => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes)
        values (${store.id}::uuid, 'video', ${`${base}/${store.id}/${name}.mp4`}, 'page-videos', ${`${store.id}/${name}.mp4`}, ${`${name}.mp4`}, 'video/mp4', 9000000)
        returning id, path
      `);
      return { id: String(row.id), path: String(row.path) };
    };
    const first = await video("first");
    const second = await video("second");
    const owner = { storeId: store.id, storeSlug: store.slug };
    const outcome = await replaceVideo(owner, store.account.id, first.id, second.path);
    expect(outcome).toEqual({ ok: false, problem: "That upload is not this site's." });
    // Nor a path outside the store's own folder.
    expect(await replaceVideo(owner, store.account.id, first.id, `someone-else/${run}.mp4`)).toEqual({ ok: false, problem: "That upload is not this site's." });
    const [still] = await db().execute<Row>(sql`select url from commerce.media where id = ${first.id}::uuid`);
    expect(String(still.url)).toContain("first.mp4");
  });
});
