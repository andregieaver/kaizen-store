import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));
// The recommendation tool reads the visitor's cookies (cart, wishlist, account): this visitor has none.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
// Stock is read per request; a test has no request to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const knowledge = await import("./knowledge");
const library = await import("./media-library");
const altTexts = await import("./alt-texts");
const embeddings = await import("./embeddings");
const moderation = await import("./content-moderation");

const run = Date.now().toString(36);
const aboutUs = new Map<number, string>();

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

/** The text of each statement the database was sent while `run` ran (each goes through `pg`'s `Client.query`). */
async function counted(run: () => Promise<unknown>): Promise<string[]> {
  const spy = vi.spyOn(pg.Client.prototype, "query");
  try {
    await run();
    return spy.mock.calls.map((c) => String(typeof c[0] === "string" ? c[0] : (c[0] as { text?: string })?.text ?? ""));
  } finally {
    spy.mockRestore();
  }
}

/** A store with its chat agent on, one published page with words and one finished picture (it has an alt text, so it is the owner's). */
async function makeSite(n: number): Promise<string> {
  const slug = `idle-${run}-${n}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Idle test', null) as id`);
  const storeId = String(created.id);
  await db().execute(sql`insert into commerce.chat_agents (store_id, enabled) values (${storeId}::uuid, true) on conflict (store_id) do update set enabled = true`);
  const [page] = await db().execute<Row>(sql`
    update commerce.pages set published = draft, published_at = now()
    where store_id = ${storeId}::uuid and type = 'page' and slug = 'om-oss' returning id
  `);
  aboutUs.set(n, String(page.id));
  const path = `${storeId}/${run}-kopp-${n}`;
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, alt, alt_source)
    values (${storeId}::uuid, 'image', ${`https://files.example.com/${path}`}, ${`https://files.example.com/${path}-480`}, 'product-media', ${path},
      ${`${path}-480`}, ${`kopp-${n}.webp`}, 'image/webp', 'En kopp', 'staff')
  `);
  return storeId;
}

/** Every job run once whole, then what is left put out of the five-minute gates' sight: a throwaway database, and the hourly pass would still see these rows. */
async function settle() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  await knowledge.refreshKnowledge({ full: true });
  await db().execute(sql`update commerce.knowledge_chunks set created_at = now() - interval '2 hours' where space is null`);
  await db().execute(sql`update commerce.media set updated_at = now() - interval '2 hours' where updated_at > now() - interval '1 hour'`);
  await db().execute(sql`update commerce.media_embeddings set updated_at = now()`);
  await db().execute(sql`update commerce.media set alt_tried_at = now() where kind = 'image' and alt_source is null`);
  await db().execute(sql`
    insert into commerce.content_screened (product_id, store_id, content_hash)
    select p.id, p.store_id, 'settled' from commerce.products p where p.status = 'active'
    on conflict (product_id) do update set screened_at = now(), tried_at = null
  `);
  vi.mocked(fetch).mockClear();
}

/** The five AI upkeep jobs' five-minute run, in the dispatcher's order, and the statements it sent. */
const idleRun = () =>
  counted(async () => {
    await knowledge.refreshKnowledge({ full: false });
    await library.refreshMediaEmbeddings({ full: false });
    await altTexts.refreshAltTexts(4, 5, { full: false });
    await embeddings.refreshEmbeddings({ full: false });
    await moderation.runContentModeration({ full: false });
  });

// The listings' check is the fifth job of this run (step 0.29). The counter is this file's own until step 1.9 gives the database client one.
describe("an idle run of the AI upkeep jobs (bloat review 0.28)", () => {
  let idleStatements = -1;

  it("an idle run with one site is a few statements, reads no AI connection and calls no model", async () => {
    await makeSite(1);
    await settle();
    const texts = await idleRun();
    idleStatements = texts.length;
    expect(texts.length).toBeLessThanOrEqual(8);
    expect(texts.filter((text) => text.includes("commerce.ai_providers"))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the same with twenty sites", { timeout: 120_000 }, async () => {
    for (let n = 2; n <= 20; n += 1) await makeSite(n);
    await settle();
    const texts = await idleRun();
    expect(idleStatements).toBeGreaterThan(0);
    expect(texts).toHaveLength(idleStatements);
    expect(texts.filter((text) => text.includes("commerce.ai_providers"))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a published page is found by the next run", async () => {
    await db().execute(sql`update commerce.pages set published_at = now() + interval '2 seconds' where id = ${aboutUs.get(1)!}::uuid`);
    const result = await knowledge.refreshKnowledge({ full: false });
    expect(result.cut).toBe(1);
  });
});
