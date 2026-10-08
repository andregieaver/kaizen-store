import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";
import { mediaQuery } from "@/lib/media-query";
import { siteUrl } from "@/lib/site";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
// Storage is Supabase's: here, removing a file always works.
const removed: string[][] = [];
vi.mock("./media", async (original) => ({
  ...(await original<typeof import("./media")>()),
  removeStoredFiles: async (_bucket: string, paths: string[]) => {
    removed.push(paths);
    return true;
  },
}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const library = await import("./media-library");

const run = Date.now().toString(36);
let storeId: string;
let storeSlug: string;
let accountId: string;
const owner = () => ({ storeId, storeSlug });
const base = `https://files.example.com/storage/v1/object/public/product-media`;

/** A stand-in search model: texts about drinking point one way, about bikes another, each word a little its own way. */
function fakeVector(text: string): number[] {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const about = (stems: string[]) => words.filter((word) => stems.some((stem) => word.includes(stem))).length;
  const spelling = new Array<number>(16).fill(0);
  for (const word of words) spelling[[...word].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 16, 3)] += 0.1;
  return [about(["kopp", "krus", "drikk", "kaffe"]), about(["sykkel", "hjelm", "tur"]), ...spelling];
}

let requests = 0;
function fakeModel() {
  requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests += 1;
      const { input } = JSON.parse(String(init.body)) as { input: string[] };
      return Response.json({ data: input.map((text, index) => ({ index, embedding: fakeVector(text) })) });
    }),
  );
}

async function addMedia(values: { store: string | null; name: string; alt?: string; kind?: "image" | "video"; size?: number; width?: number | null }) {
  const kind = values.kind ?? "image";
  const path = `${values.store ?? "platform"}/${run}-${values.name}`;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height, alt, alt_source)
    values (${values.store}::uuid, ${kind}, ${`${base}/${path}`}, ${kind === "image" ? `${base}/${path}-480` : null},
      ${kind === "image" ? "product-media" : "page-videos"}, ${path}, ${kind === "image" ? `${path}-480` : null},
      ${values.name}, ${kind === "image" ? "image/webp" : "video/mp4"}, ${values.size ?? 1000},
      ${values.width === undefined ? 800 : values.width}, ${values.width === null ? null : 600}, ${values.alt ?? ""},
      ${values.alt ? "staff" : null})
    returning id, url, thumbnail_url
  `);
  return { id: String(row.id), url: String(row.url), thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null };
}

let mug: Awaited<ReturnType<typeof addMedia>>;
let bike: Awaited<ReturnType<typeof addMedia>>;
let film: Awaited<ReturnType<typeof addMedia>>;
let kaizens: Awaited<ReturnType<typeof addMedia>>;

beforeAll(async () => {
  storeSlug = `media-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${storeSlug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${storeSlug}, 'Test', null) as id`);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${storeSlug}@example.com`}`);
  accountId = String(account.id);
  const form = new FormData();
  for (const [name, value] of Object.entries({ provider: "mistral", apiKey: "store-key", embeddingModel: "mistral-embed", minSimilarity: "0.5" })) {
    form.set(name, value);
  }
  form.set("enabled", "on");
  expect(await ai.saveAiSettings(accountId, storeId, aiFormValues(form))).toEqual({ ok: true });

  mug = await addMedia({ store: storeId, name: "keramikk-kopp.webp", alt: "Hvit kopp på et bord", size: 5000 });
  bike = await addMedia({ store: storeId, name: "sykkel_i_skogen.webp", size: 90_000, width: null });
  film = await addMedia({ store: storeId, name: "hytta.mp4", kind: "video", size: 2_000_000 });
  kaizens = await addMedia({ store: null, name: `kaizen-kopp-${run}.webp` });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db().execute(sql`delete from commerce.media where id = ${kaizens.id}::uuid`);
  await closeDb();
});

const names = (items: { fileName: string }[]) => items.map((item) => item.fileName);

describe("the media library (D88)", () => {
  it("lists the owner's files in the chosen order, by kind, and never another site's", async () => {
    const newest = await library.listMedia(owner(), mediaQuery({}));
    expect(newest.total).toBe(3);
    expect(names(newest.items)).toEqual(["hytta.mp4", "sykkel_i_skogen.webp", "keramikk-kopp.webp"]);
    expect(names((await library.listMedia(owner(), mediaQuery({ sort: "largest" }))).items)[0]).toBe("hytta.mp4");
    expect(names((await library.listMedia(owner(), mediaQuery({ sort: "name" }))).items)).toEqual([
      "hytta.mp4",
      "keramikk-kopp.webp",
      "sykkel_i_skogen.webp",
    ]);
    expect(names((await library.listMedia(owner(), mediaQuery({ kind: "video" }))).items)).toEqual(["hytta.mp4"]);
    expect(names((await library.listMedia(owner(), mediaQuery({ q: "kopp" }))).items)).toEqual(["keramikk-kopp.webp"]);
    // Kaizen's library holds Kaizen's.
    const platform = await library.listMedia({ storeId: null, storeSlug: null }, mediaQuery({ q: `kaizen kopp ${run}` }));
    expect(names(platform.items)).toEqual([`kaizen-kopp-${run}.webp`]);
  });

  it("finds files by the words of their name and description, the start of a word, or a misspelling", async () => {
    const find = async (q: string) => names((await library.listMedia(owner(), mediaQuery({ q }))).items);
    fakeModel();
    // Words in a name are split at dots, dashes and underscores.
    expect(await find("skogen")).toEqual(["sykkel_i_skogen.webp"]);
    expect(await find("bord")).toEqual(["keramikk-kopp.webp"]);
    expect(await find("syk")).toEqual(["sykkel_i_skogen.webp"]);
    expect(await find("sykel")).toEqual(["sykkel_i_skogen.webp"]);
    expect(await find("lampe")).toEqual([]);
  });

  it("finds files by meaning with the store's AI, embedding each once until it changes", async () => {
    fakeModel();
    expect(await library.embedMedia(owner(), (await ai.aiFor(storeId))!)).toEqual({ embedded: 3, failed: null });
    expect(requests).toBe(1);
    fakeModel();
    expect(await library.embedMedia(owner(), (await ai.aiFor(storeId))!)).toEqual({ embedded: 0, failed: null });
    expect(requests).toBe(0);

    // No word matches, but it is about drinking.
    fakeModel();
    const found = await library.listMedia(owner(), mediaQuery({ q: "noe å drikke kaffe av" }));
    expect(names(found.items)).toEqual(["keramikk-kopp.webp"]);

    // A new description is embedded again.
    expect(await library.describeMedia(owner(), accountId, bike.id, { alt: "Terrengsykkel og hjelm", translations: {} })).toBe(true);
    fakeModel();
    expect((await library.embedMedia(owner(), (await ai.aiFor(storeId))!)).embedded).toBe(1);
    expect(names((await library.listMedia(owner(), mediaQuery({ q: "hjelm" }))).items)).toEqual(["sykkel_i_skogen.webp"]);
  });

  it("says everywhere a file is used: products, pages, menus, the logo", async () => {
    const [product] = await db().execute<Row>(sql`
      select p.id, (select title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1) as title
      from commerce.products p where p.store_id = ${storeId}::uuid and p.handle = 'demo-keramikkopp'
    `);
    await db().execute(sql`
      insert into commerce.product_media (store_id, product_id, url, thumbnail_url, position)
      values (${storeId}::uuid, ${String(product.id)}::uuid, ${mug.url}, ${mug.thumbnailUrl}, 9)
    `);
    const content = { title: "Om oss", rows: [{ id: "r", columns: [{ id: "c", blocks: [{ id: "i", type: "image", url: mug.thumbnailUrl }] }] }] };
    const [page] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${storeId}::uuid, ${`om-${run}`}, ${JSON.stringify(content)}::jsonb, ${JSON.stringify(content)}::jsonb, now()) returning id
    `);
    const [menu] = await db().execute<Row>(sql`
      insert into commerce.menus (store_id, name, items)
      values (${storeId}::uuid, 'Mega', ${JSON.stringify([{ label: {}, link: { kind: "home" }, depth: 0, image: { url: mug.url } }])}::jsonb) returning id
    `);
    await db().execute(sql`
      update commerce.stores set navigation = jsonb_set(coalesce(navigation, '{}'), '{logo}', ${JSON.stringify({ url: mug.url })}::jsonb)
      where id = ${storeId}::uuid
    `);

    const uses = (await library.mediaUses(owner(), [mug.id, bike.id])).get(mug.id)!;
    // Each with where to change it and, where visitors see it, its address on the store's site in its main market (D89).
    // Without the country: the store sells in its own alone (D181).
    const site = `${siteUrl()}/s/${storeSlug}`;
    expect(uses).toEqual(
      expect.arrayContaining([
        {
          label: `Product: ${String(product.title)}`,
          href: `/admin/${storeSlug}/products/${String(product.id)}`,
          siteUrl: `${site}/p/demo-keramikkopp`,
        },
        { label: "Page: Om oss", href: `/admin/${storeSlug}/pages/${String(page.id)}`, siteUrl: `${site}/om-${run}` },
        { label: "Menu: Mega", href: `/admin/${storeSlug}/menus?menu=${String(menu.id)}`, siteUrl: null },
        { label: "Logo and icon (Header and footer)", href: `/admin/${storeSlug}/settings/navigation`, siteUrl: site },
      ]),
    );
    // A page not published is not on the site.
    await db().execute(sql`update commerce.pages set published = null, published_at = null where id = ${String(page.id)}::uuid`);
    const drafted = (await library.mediaUses(owner(), [mug.id])).get(mug.id)!;
    expect(drafted.find((use) => use.label === "Page: Om oss")?.siteUrl).toBeNull();
    expect(uses).toHaveLength(4);
    expect((await library.mediaUses(owner(), [bike.id])).get(bike.id)).toEqual([]);
    // Kaizen's library does not see a store's uses.
    expect((await library.mediaUses({ storeId: null, storeSlug: null }, [mug.id])).get(mug.id)).toEqual([]);
    // What a file is used for is part of what search by meaning reads.
    const uses2 = [{ label: "Product: Demo: Kopp", href: null }, { label: "Menu: Mega", href: null }];
    expect(library.mediaDocument("keramikk-kopp.webp", "Hvit kopp", { en: "A white mug", "sv-SE": "Hvit kopp" }, uses2)).toBe(
      "Hvit kopp\nA white mug\nkeramikk kopp\nUsed in: Product: Demo: Kopp; Menu: Mega",
    );
    // A file named by an id and without alt texts has nothing to be found by.
    expect(library.mediaDocument("d58a9064-875d-450f-aceb-4e6b17a0716c.webp", "", {}, uses2)).toBe("");
  });

  it("keeps measurements taken in the browser only for files without them", async () => {
    await library.measureMedia(owner(), bike.id, 1600, 1200);
    await library.measureMedia(owner(), mug.id, 1, 1);
    const [items] = [(await library.listMedia(owner(), mediaQuery({ sort: "name" }))).items];
    const byName = new Map(items.map((item) => [item.fileName, item]));
    expect(byName.get("sykkel_i_skogen.webp")).toMatchObject({ width: 1600, height: 1200 });
    expect(byName.get("keramikk-kopp.webp")).toMatchObject({ width: 800, height: 600 });
  });

  it("deletes a file from Storage and the library, only the owner's, and records who did", async () => {
    expect(await library.describeMedia({ storeId: null, storeSlug: null }, accountId, film.id, { alt: "Nope", translations: {} })).toBe(false);
    expect(await library.deleteMedia({ storeId: null, storeSlug: null }, accountId, film.id)).toEqual({
      ok: false,
      problem: "That file is no longer in the library.",
    });
    removed.length = 0;
    expect(await library.deleteMedia(owner(), accountId, mug.id)).toEqual({ ok: true });
    expect(removed).toEqual([[mug.url.slice(base.length + 1), `${mug.url.slice(base.length + 1)}-480`]]);
    const [left] = await db().execute<Row>(sql`
      select (select count(*)::int from commerce.media where id = ${mug.id}::uuid) as media,
        (select count(*)::int from commerce.media_embeddings where media_id = ${mug.id}::uuid) as vectors,
        (select count(*)::int from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.media_deleted') as logged
    `);
    expect(left).toEqual({ media: 0, vectors: 0, logged: 1 });
    expect((await library.listMedia(owner(), mediaQuery({}))).total).toBe(2);
  });

  it("deletes several files at once: one request to Storage per bucket, only the owner's, one audit entry, and says what was kept", async () => {
    const a = await addMedia({ store: storeId, name: `bulk-a-${run}.webp` });
    const b = await addMedia({ store: storeId, name: `bulk-b-${run}.webp` });
    const clip = await addMedia({ store: storeId, name: `bulk-c-${run}.mp4`, kind: "video" });
    const [before] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.media_deleted'`);
    removed.length = 0;
    // Kaizen's own file and an id nobody has are not the store's: kept, and counted so.
    const outcome = await library.deleteMediaMany(owner(), accountId, [a.id, b.id, clip.id, kaizens.id, "00000000-0000-4000-8000-000000000000", a.id]);
    expect(outcome).toMatchObject({ deleted: 3, kept: 2 });
    expect(outcome.problem).toBeDefined();
    // The two pictures went in one call (each with its small copy), the video in another.
    expect(removed).toHaveLength(2);
    expect(removed.flat()).toHaveLength(5);
    const [after] = await db().execute<Row>(sql`
      select (select count(*)::int from commerce.media where id in (${a.id}::uuid, ${b.id}::uuid, ${clip.id}::uuid)) as gone,
        (select count(*)::int from commerce.media where id = ${kaizens.id}::uuid) as kaizens,
        (select count(*)::int from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.media_deleted') as logged
    `);
    expect(after).toEqual({ gone: 0, kaizens: 1, logged: Number(before.n) + 1 });
    expect(await library.deleteMediaMany(owner(), accountId, [])).toEqual({ deleted: 0, kept: 0 });
    // More than a request takes is cut to the limit, never an error.
    expect((await library.deleteMediaMany(owner(), accountId, Array.from({ length: library.MEDIA_DELETE_MAX + 20 }, () => "00000000-0000-4000-8000-000000000001").map((id, i) => id.replace(/1$/, String(i % 10))))).deleted).toBe(0);
  });

  it("finds a file by its whole name alone, and pictures by their alt texts in any language", async () => {
    const uuid = (n: number) => `${String(n).repeat(8)}-875d-450f-aceb-4e6b17a0716c`;
    const inside = await addMedia({ store: storeId, name: `${uuid(1)}.webp` });
    await addMedia({ store: storeId, name: `${uuid(2)}.webp` });
    await addMedia({ store: storeId, name: `${uuid(3)}.webp` });
    await db().execute(sql`
      update commerce.media set alt = 'Interiør i bil med svarte seter', alt_source = 'ai',
        alt_translations = '{"en": "The inside of a car with black seats"}'
      where id = ${inside.id}::uuid
    `);
    fakeModel();
    const find = async (q: string) => names((await library.listMedia(owner(), mediaQuery({ q }))).items);
    // The whole name, with or without its ending, or its start: that file, and never files merely named alike.
    expect(await find(`${uuid(2)}.webp`)).toEqual([`${uuid(2)}.webp`]);
    expect(await find(uuid(3).toUpperCase())).toEqual([`${uuid(3)}.webp`]);
    expect(await find("22222222-875d")).toEqual([`${uuid(2)}.webp`]);
    expect(requests).toBe(0);
    // Words find alt texts in any of their languages.
    expect(await find("car")).toEqual([`${uuid(1)}.webp`]);
    expect(await find("bil")).toEqual([`${uuid(1)}.webp`]);
    // Only the described one gets a vector: ids alone say nothing of what a file shows.
    fakeModel();
    await library.embedMedia(owner(), (await ai.aiFor(storeId))!);
    const [vectors] = await db().execute<Row>(sql`
      select count(*) filter (where m.alt <> '')::int as described, count(*) filter (where m.alt = '')::int as bare
      from commerce.media_embeddings e join commerce.media m on m.id = e.media_id
      where m.store_id = ${storeId}::uuid and m.file_name like '%-875d-%'
    `);
    expect(vectors).toEqual({ described: 1, bare: 0 });
  });
});
