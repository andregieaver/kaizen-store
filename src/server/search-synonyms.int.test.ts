import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const search = await import("./search");
const synonyms = await import("./search-synonyms");
const { SYNONYMS_MAX } = await import("@/lib/search-synonyms");

/** Search synonyms (wave 6 unit F1, D324, `docs/wave-6-catalogue.md` F.1). */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const handle = new Map<string, string>();
const stores: { id: string; slug: string }[] = [];
let accountId: string;

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  const id = String(store.id);
  for (const row of await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${id}::uuid`)) handle.set(String(row.id), String(row.handle));
  stores.push({ id, slug });
  return id;
}

const writer = (storeId: string, keptLocales = ["nb-NO", "en"]) => ({ account: { id: accountId }, store: { id: storeId, localization: { keptLocales } } });

const find = async (storeId: string, query: string, prefix = false) =>
  (await search.matchingIds({ storeId, market: no }, query, 10, prefix)).map((id) => handle.get(id));

beforeAll(async () => {
  await makeStore(`syn-${run}`);
  await makeStore(`syn-other-${run}`);
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`syn-account-${run}@example.com`}, 'S') returning id`);
  accountId = String(account.id);
});

afterAll(async () => {
  await closeDb();
});

describe("search synonyms", () => {
  it("finds a product by a word the store says means the same, in that store and language only", async () => {
    const [store, other] = stores;
    expect(await find(store.id, "skvulpefat")).toEqual([]);
    const saved = await synonyms.saveSynonym(writer(store.id), { locale: "nb-NO", kind: "both", words: ["Skvulpefat", "keramikkopp"] });
    expect(saved).toMatchObject({ ok: true });
    expect((await find(store.id, "skvulpefat"))[0]).toBe("demo-keramikkopp");
    expect(await find(store.id, "skvulpefat oppvaskmaskin")).toContain("demo-keramikkopp");
    // While typing too.
    expect(await find(store.id, "skvulpefat", true)).toContain("demo-keramikkopp");
    // Another store, and another language of the same store, are unchanged.
    expect(await find(other.id, "skvulpefat")).toEqual([]);
    expect(await synonyms.synonymsFor(store.id, "en")).toEqual([]);
    expect(await synonyms.synonymsFor(store.id, "nb-NO")).toEqual([{ kind: "both", words: ["skvulpefat", "keramikkopp"], means: [] }]);
  });

  it("finds one way only", async () => {
    const [store] = stores;
    expect(await synonyms.saveSynonym(writer(store.id), { locale: "nb-NO", kind: "one_way", words: ["lysgiver"], means: ["bordlampe"] })).toMatchObject({ ok: true });
    expect((await find(store.id, "lysgiver"))[0]).toBe("demo-bordlampe");
    // "bordlampe" does not find what "lysgiver" names: no product says it, so nothing new comes of it.
    expect(await find(store.id, "bordlampe")).toEqual(await find(stores[1].id, "bordlampe"));
  });

  it("refuses a language the store does not keep, words a search cannot hold and a group of another store", async () => {
    const [store, other] = stores;
    expect(await synonyms.saveSynonym(writer(store.id), { locale: "de-DE", kind: "both", words: ["a1", "b1"] })).toEqual({ ok: false, problems: [{ code: "locale" }] });
    expect(await synonyms.saveSynonym(writer(store.id), { locale: "nb-NO", kind: "both", words: ["a1", "b | c"] })).toMatchObject({ ok: false });
    const [mine] = await synonyms.listSynonyms(store.id);
    // The other store can neither change nor delete it.
    expect(await synonyms.saveSynonym(writer(other.id), { id: mine.id, locale: "nb-NO", kind: "both", words: ["x1", "y1"] })).toEqual({ ok: false, problems: [{ code: "gone" }] });
    expect(await synonyms.deleteSynonym(writer(other.id), mine.id)).toBe(false);
    expect((await synonyms.listSynonyms(store.id)).map((row) => row.id)).toContain(mine.id);
  });

  it("changes and deletes a group, and audits both", async () => {
    const [store] = stores;
    const made = await synonyms.saveSynonym(writer(store.id), { locale: "en", kind: "both", words: ["mug", "cup"] });
    if (!made.ok) throw new Error("not saved");
    expect(await synonyms.saveSynonym(writer(store.id), { id: made.id, locale: "en", kind: "both", words: ["mug", "beaker"] })).toEqual({ ok: true, id: made.id });
    expect(await synonyms.synonymsFor(store.id, "en")).toEqual([{ kind: "both", words: ["mug", "beaker"], means: [] }]);
    expect(await synonyms.deleteSynonym(writer(store.id), made.id)).toBe(true);
    expect(await synonyms.deleteSynonym(writer(store.id), made.id)).toBe(false);
    const actions = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.id}::uuid and action like 'search.%' order by created_at`);
    expect(actions.map((row) => row.action)).toEqual(["search.synonym_saved", "search.synonym_saved", "search.synonym_saved", "search.synonym_saved", "search.synonym_deleted"]);
  });

  it("keeps at most 500 groups a store, in the writer and in the database", async () => {
    const [, other] = stores;
    await db().execute(sql`
      insert into commerce.search_synonyms (store_id, locale, kind, words)
      select ${other.id}::uuid, 'nb-NO', 'both', array['w' || n, 'v' || n] from generate_series(1, ${SYNONYMS_MAX}) n
    `);
    expect(await synonyms.saveSynonym(writer(other.id), { locale: "nb-NO", kind: "both", words: ["a1", "b1"] })).toEqual({ ok: false, problems: [{ code: "max" }] });
    await expect(db().execute(sql`insert into commerce.search_synonyms (store_id, locale, kind, words) values (${other.id}::uuid, 'nb-NO', 'both', array['a1', 'b1'])`)).rejects.toThrow();
    await db().execute(sql`delete from commerce.search_synonyms where store_id = ${other.id}::uuid`);
  });

  it("goes with the store when it is copied", async () => {
    const [store] = stores;
    const before = await synonyms.synonymsFor(store.id, "nb-NO");
    const [made] = await db().execute<Row>(sql`
      select commerce.duplicate_store(${store.id}::uuid, ${`syn-copy-${run}`}, 'Copy', ${accountId}::uuid, '{}'::uuid[], '{}'::uuid[], '{}'::uuid[]) as id
    `);
    expect(await synonyms.synonymsFor(String(made.id), "nb-NO")).toEqual(before);
    const [cloned] = await db().execute<Row>(sql`select commerce.clone_store(${store.id}::uuid, ${`syn-clone-${run}`}, 'Kopi', ${accountId}::uuid) as id`);
    expect(await synonyms.synonymsFor(String(cloned.id), "nb-NO")).toEqual(before);
  });
});
