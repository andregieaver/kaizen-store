import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { PACK_KEYS, packSlots } from "@/lib/content-packs";
import { contentPack } from "@/lib/content-packs";
import { parsePageContent } from "@/lib/page-content";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const packs = await import("./content-packs");
const { publishStarter } = await import("./store-starters");
const takes = await import("./home-takes");

/**
 * Taking a demo store's home page (`docs/theme-showcase-phase-1.md` step 4c): a published pack's home page copied into a store as its front
 * page, its pictures copied into the store's library, the front page before kept; *Put back* chooses that one again and deletes the copy
 * unless the owner changed it.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const list = (values: readonly string[]) => `{${values.join(",")}}`;
const storage = (path: string) => `https://x.supabase.co/storage/v1/object/public/media/${path}`;
const deps = { copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}` };

let admin: Account;
let storeId: string;
let ownPage: string;

const front = async () => (await one(sql`select front_page_id from commerce.stores where id = ${storeId}::uuid`)).front_page_id as string | null;

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`takes-${run}@example.com`}, 'Platform', true) returning id, email`);
  admin = { id: String(a.id), email: String(a.email), name: "Platform", platformAdmin: true } as Account;
  // A database that ran the packs before keeps them: set them aside, so this run makes and publishes its own food pack.
  await db().execute(sql`
    update commerce.stores s set slug = left(s.slug, 20) || '-' || ${run}
    from commerce.store_starters ss where ss.store_id = s.id and ss.pack_key = any(${list(PACK_KEYS)}::text[])
  `);
  await db().execute(sql`update commerce.store_starters set pack_key = pack_key || '-' || ${run} where pack_key = any(${list(PACK_KEYS)}::text[])`);
  const synced = await packs.syncContentPacks(admin);
  expect(synced.problems).toEqual([]);
  // Its pictures, as the picture model would make them: files in Storage, in the pack's own library.
  const pack = await one(sql`select ss.id as starter, ss.store_id from commerce.store_starters ss where ss.pack_key = 'food'`);
  let n = 0;
  const make = (async () => {
    n++;
    const path = `pack-food-${run}/${n}.webp`;
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, width, height)
      values (${String(pack.store_id)}::uuid, 'image', ${storage(path)}, 'media', ${path}, ${`${n}.webp`}, 'image/webp', 1000, 1536, 1024)
    `);
    return { ok: true, picture: { url: storage(path), thumbnailUrl: null, width: 1536, height: 1024 } };
  }) as never;
  const connection = { image: { provider: "openai", apiUrl: "https://example.invalid", apiKey: "x", model: "picture", quality: null } } as never;
  for (let i = 0; i < packSlots(contentPack("food")!).length; i++) await packs.makeNextPackPicture(admin, "food", { connection, make });
  expect(await publishStarter(admin, String(pack.starter))).toMatchObject({ ok: true });

  // A store of the owner's, opening with a page of its own.
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`takes-owner-${run}@example.com`}, 'Owner', 'Takes') returning id`);
  storeId = String((await one(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`takes-${run}`}, 'Takes', null) as id`)).id);
  ownPage = String((await front()) ?? "");
  expect(ownPage).not.toBe("");
}, 180_000);

afterAll(async () => {
  await closeDb();
});

describe("a demo store's home page", () => {
  it("is offered while its pack is published, with a place to look at it", async () => {
    const offers = await takes.homePageOffers();
    expect(offers.find((o) => o.pack === "food")).toMatchObject({ name: "Harbour Pantry", trade: "Food and drink" });
    expect(offers.some((o) => o.pack === "beauty")).toBe(false);
    expect(await takes.latestHomeTake(storeId)).toBeNull();
  });

  it("becomes the store's front page, with its pictures copied into the store's library and the front page before kept", async () => {
    expect(await takes.takePackHome(admin.id, storeId, "beauty", deps)).toMatchObject({ ok: false });
    const taken = await takes.takePackHome(admin.id, storeId, "food", deps);
    if (!taken.ok) throw new Error(taken.problems.join(" "));
    expect(await front()).toBe(taken.pageId);
    const page = await one(sql`select slug, published, draft from commerce.pages where id = ${taken.pageId}::uuid`);
    expect(page.published).toEqual(page.draft);
    const content = parsePageContent(page.published)!;
    expect(content.title).toBe("Home page");
    // Its pictures are this store's copies, never the pack's files.
    const text = JSON.stringify(content);
    expect(text).not.toContain(`pack-food-${run}/`);
    expect(text).toContain(`/public/media/${storeId}/`);
    const copied = await one(sql`select count(*)::int as n from commerce.media where store_id = ${storeId}::uuid`);
    expect(Number(copied.n)).toBeGreaterThan(0);
    expect(await takes.latestHomeTake(storeId)).toMatchObject({ pack: "food", name: "Harbour Pantry", pageId: taken.pageId, copyIsFront: true });
  });

  it("is put back to the front page before, and the copy deleted while the owner has not changed it", async () => {
    const take = (await takes.latestHomeTake(storeId))!;
    const back = await takes.undoHomeTake(admin.id, storeId, take.id);
    expect(back).toEqual({ ok: true, messages: ["Your front page is back."] });
    expect(await front()).toBe(ownPage);
    expect(await one(sql`select id from commerce.pages where id = ${take.pageId}::uuid`)).toBeUndefined();
    expect(await takes.latestHomeTake(storeId)).toBeNull();
    // Done once.
    expect(await takes.undoHomeTake(admin.id, storeId, take.id)).toMatchObject({ ok: false });
  });

  it("keeps a copy the owner changed, and a front page they chose since", async () => {
    const taken = await takes.takePackHome(admin.id, storeId, "food", deps);
    if (!taken.ok) throw new Error(taken.problems.join(" "));
    await db().execute(sql`update commerce.pages set updated_at = clock_timestamp() where id = ${taken.pageId}::uuid`);
    const changed = (await takes.latestHomeTake(storeId))!;
    expect(await takes.undoHomeTake(admin.id, storeId, changed.id)).toEqual({
      ok: true,
      messages: ["Your front page is back.", "The home page you took stays in your pages, as you changed it."],
    });
    expect(await one(sql`select id from commerce.pages where id = ${taken.pageId}::uuid`)).toBeDefined();

    const again = await takes.takePackHome(admin.id, storeId, "food", deps);
    if (!again.ok) throw new Error(again.problems.join(" "));
    await db().execute(sql`update commerce.stores set front_page_id = ${taken.pageId}::uuid where id = ${storeId}::uuid`);
    const moved = (await takes.latestHomeTake(storeId))!;
    expect(moved.copyIsFront).toBe(false);
    const kept = await takes.undoHomeTake(admin.id, storeId, moved.id);
    expect(kept).toMatchObject({ ok: true, messages: ["You chose another front page since, so it stays."] });
    expect(await front()).toBe(taken.pageId);
    expect(await one(sql`select id from commerce.pages where id = ${again.pageId}::uuid`)).toBeUndefined();
    const logged = await one(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action in ('store.front_page_from_pack', 'store.front_page_put_back')`);
    expect(Number(logged.n)).toBe(6);
  });
});
