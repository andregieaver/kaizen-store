import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { pictureItem } from "@/lib/product-media";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { getProduct, listProducts } = await import("./catalog");
const { mediaUses, registerModel } = await import("./media-library");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * Videos and 3D models in a product's gallery (wave 6 unit G1, D325): saved from the editor in its order and read back the same, the card's
 * picture the first item's (a video's poster), another store's or another site's file refused, a file the product already had kept, copies
 * carrying them, and the media library saying where a model is used.
 */

const BASE = "https://project.supabase.co/storage/v1/object/public";
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let slug: string;
let productId: string;
let handle: string;
let accountId: string;

const videoItem = (folder: string) => ({
  ...pictureItem("https://x.example/poster.webp", "https://x.example/poster-small.webp", "Slik brukes den"),
  kind: "video" as const,
  source: "upload" as const,
  mediaUrl: `${BASE}/page-videos/${folder}/clip.mp4`,
});
const youtubeItem = { ...pictureItem("https://x.example/yt.webp", null, "Fra YouTube"), kind: "video" as const, source: "youtube" as const, mediaUrl: "https://youtu.be/dQw4w9WgXcQ" };
const modelItem = (folder: string) => ({
  ...pictureItem("https://x.example/model.webp", null, "Koppen i 3D"),
  kind: "model" as const,
  mediaUrl: `${BASE}/product-models/${folder}/cup.glb`,
});

beforeAll(async () => {
  const made = await newStore("product-media");
  storeId = made.storeId;
  slug = made.slug;
  const [row] = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid and status = 'active' and kind = 'goods' order by handle limit 1`);
  productId = String(row.id);
  handle = String(row.handle);
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`media-${Date.now()}@example.com`}, 'M') returning id`);
  accountId = String(account.id);
});

afterAll(async () => {
  await closeDb();
});

describe("a product's gallery (D325)", () => {
  it("keeps videos and models in the owner's order, with words per language, and reads them back the same", async () => {
    const store = (await getStore(slug))!;
    // A second language, as a store with Several languages has: its words are kept as typed.
    const one = await getEditorContext(store);
    const editor = { ...one, locales: [...one.locales, "en"] };
    const input = (await getProductForEdit(store, editor, productId))!;
    const picture = input.media[0];
    input.media = [videoItem(storeId), picture, { ...youtubeItem, alts: { "en": "From YouTube" } }, modelItem(storeId)];
    expect(await saveProduct(store, editor, productId, input)).toMatchObject({ ok: true });

    const back = (await getProductForEdit(store, editor, productId))!;
    expect(back.media.map((m) => [m.kind, m.source])).toEqual([["video", "upload"], ["image", null], ["video", "youtube"], ["model", null]]);
    expect(back.media[0]).toMatchObject({ mediaUrl: videoItem(storeId).mediaUrl, alt: "Slik brukes den" });
    expect(back.media[2].alts).toEqual(expect.objectContaining({ en: "From YouTube" }));

    // The product page reads every item; a card reads the first item's picture: the video's poster.
    const product = (await getProduct(storeId, no, handle))!;
    expect(product.images.map((i) => i.kind)).toEqual(["video", "image", "video", "model"]);
    expect(product.images[3].mediaUrl).toBe(modelItem(storeId).mediaUrl);
    const card = (await listProducts(storeId, no)).find((p) => p.handle === handle)!;
    expect(card.image?.url).toBe("https://x.example/poster-small.webp");
  });

  it("refuses another store's file or another site's, and limits videos and models", async () => {
    const store = (await getStore(slug))!;
    const editor = await getEditorContext(store);
    const input = (await getProductForEdit(store, editor, productId))!;
    const other = "00000000-0000-4000-8000-000000000001";
    const refused = await saveProduct(store, editor, productId, { ...input, media: [...input.media.filter((m) => m.kind === "image"), videoItem(other)] });
    expect(refused).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.stringContaining("not one of the store's own uploads")]) });
    const elsewhere = await saveProduct(store, editor, productId, {
      ...input,
      media: [...input.media.filter((m) => m.kind === "image"), { ...videoItem(storeId), mediaUrl: "https://example.com/clip.mp4" }],
    });
    expect(elsewhere.ok).toBe(false);
    const many = Array.from({ length: 4 }, () => modelItem(storeId));
    expect(await saveProduct(store, editor, productId, { ...input, media: [...input.media.filter((m) => m.kind === "image"), ...many] })).toMatchObject({
      ok: false,
      problems: expect.arrayContaining(["Use at most 3 3D models."]),
    });
    // A file the product already had stays, wherever it lies (a store made from a template keeps the template's until it is copied).
    await db().execute(sql`update commerce.product_media set media_url = ${`${BASE}/product-models/${other}/cup.glb`} where product_id = ${productId}::uuid and kind = 'model'`);
    const kept = (await getProductForEdit(store, editor, productId))!;
    expect(await saveProduct(store, editor, productId, kept)).toMatchObject({ ok: true });
    await db().execute(sql`update commerce.product_media set media_url = ${modelItem(storeId).mediaUrl} where product_id = ${productId}::uuid and kind = 'model'`);
  });

  it("holds each kind's shape in the database too", async () => {
    await expect(
      db().execute(sql`insert into commerce.product_media (store_id, product_id, url, kind) values (${storeId}::uuid, ${productId}::uuid, 'https://x.example/a.webp', 'video')`),
    ).rejects.toThrow();
    await expect(
      db().execute(sql`insert into commerce.product_media (store_id, product_id, url, kind, media_url) values (${storeId}::uuid, ${productId}::uuid, 'https://x.example/a.webp', 'image', 'x')`),
    ).rejects.toThrow();
  });

  it("go with the store when it is copied, and the media library says where a model is used", async () => {
    const [made] = await db().execute<Row>(sql`
      select commerce.duplicate_store(${storeId}::uuid, ${`${slug}-copy`}, 'Copy', ${accountId}::uuid, null, null, null) as id
    `);
    const copied = await db().execute<Row>(sql`
      select m.kind, m.source, m.media_url from commerce.product_media m join commerce.products p on p.id = m.product_id
      where m.store_id = ${String(made.id)}::uuid and p.handle = ${handle} order by m.position
    `);
    expect(copied.map((r) => r.kind)).toEqual(["video", "image", "video", "model"]);
    expect(copied[2]).toMatchObject({ source: "youtube", media_url: "https://youtu.be/dQw4w9WgXcQ" });

    const url = modelItem(storeId).mediaUrl;
    await registerModel({ storeId, accountId }, { url, bucket: "product-models", path: `${storeId}/cup.glb` }, { name: "cup.glb", type: "model/gltf-binary", size: 1024 });
    const [media] = await db().execute<Row>(sql`select id, kind from commerce.media where store_id = ${storeId}::uuid and url = ${url}`);
    expect(media.kind).toBe("model");
    const uses = await mediaUses({ storeId, storeSlug: slug }, [String(media.id)]);
    expect(uses.get(String(media.id))?.map((u) => u.source)).toContain("product");
  });
});
