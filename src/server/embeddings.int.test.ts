import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";
import { toMarket } from "@/lib/markets";

import type { Meaning } from "./search";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const embeddings = await import("./embeddings");
const search = await import("./search");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;
const handle = new Map<string, string>();

/**
 * A stand-in search model that understands a few ideas: each text is
 * scored on drinking, light, cabins, bikes, paper, bags and massage, so
 * related texts point the same way whatever words they use, plus a little
 * for each word by its spelling, so unrelated texts point different ways.
 */
const CONCEPTS = [
  ["kopp", "krus", "mugg", "kaffe", "drikke", "te"],
  ["lampe", "lys", "belysning", "lampa"],
  ["hytte", "stuga", "overnatting", "ferie", "vannet", "sjøen"],
  ["sykkel", "cykel", "hjelm"],
  ["notatbok", "notat", "papir", "dagbok", "skrive"],
  ["handlenett", "veske", "bære"],
  ["massasje", "avslapning", "rygg"],
];
function fakeVector(text: string): number[] {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const vector = CONCEPTS.map((stems) =>
    words.filter((word) => stems.some((stem) => (stem.length < 4 ? word === stem : word.includes(stem)))).length,
  );
  const spelling = new Array<number>(32).fill(0);
  for (const word of words) {
    const bucket = [...word].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 32, 7);
    spelling[bucket] += 0.15;
  }
  return [...vector, ...spelling];
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

function form(values: Record<string, string | boolean>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (value === true) data.set(name, "on");
    else if (value !== false) data.set(name, value);
  }
  return aiFormValues(data);
}

const ownAi = { provider: "mistral", apiKey: "store-key", embeddingModel: "mistral-embed", minSimilarity: "0.5", enabled: true };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`embed-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`embed-${run}`}, 'Test', null) as id
  `);
  // A new store starts with the shop alone (D178): the demo appointment, stay and rental are offered with their features on, as an owner switches them under Features.
  await db().execute(sql`update commerce.stores set features = features || array['appointments', 'bookings']::text[] where slug = ${`embed-${run}`}`);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`embed-${run}@example.com`}`);
  accountId = String(account.id);
  const rows = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid`);
  for (const row of rows) handle.set(String(row.id), String(row.handle));
  // The store brings its own AI, so Kaizen's (shared by other tests) does not matter here.
  expect(await ai.saveAiSettings(accountId, storeId, form(ownAi))).toEqual({ ok: true });
});

beforeEach(() => fakeModel());

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

const vectorCount = async () =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.product_embeddings where store_id = ${storeId}::uuid`))[0].n);

/** The meaning of a query, as the search page would get it. */
async function meaningOf(query: string): Promise<Meaning> {
  const connection = (await ai.aiFor(storeId))!;
  return { vector: fakeVector(query), space: connection.space!, minSimilarity: connection.minSimilarity };
}

const handles = (ids: string[]) => ids.map((id) => handle.get(id));

describe("search by meaning (S2, D74)", () => {
  it("embeds every active product's translations once, and again only when their text changes", async () => {
    const [active] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.product_translations t
      join commerce.products p on p.id = t.product_id where t.store_id = ${storeId}::uuid and p.status = 'active'
    `);
    const first = await embeddings.refreshStoreEmbeddings(storeId);
    expect(first).toEqual({ embedded: Number(active.n), failed: null });
    expect(await vectorCount()).toBe(Number(active.n));
    expect(requests).toBe(Math.ceil(Number(active.n) / 32));

    // Nothing changed: nothing is sent.
    fakeModel();
    expect(await embeddings.refreshStoreEmbeddings(storeId)).toEqual({ embedded: 0, failed: null });
    expect(requests).toBe(0);

    // A new title, or a new category, embeds that translation again.
    await db().execute(sql`
      update commerce.product_translations set title = 'Demo: Keramikkrus'
      where store_id = ${storeId}::uuid and locale = 'nb-NO' and product_id = (
        select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-keramikkopp')
    `);
    expect((await embeddings.refreshStoreEmbeddings(storeId)).embedded).toBe(1);
    const [term] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, name, slug)
      values (${storeId}::uuid, 'product', 'tag', 'Gave', 'gave') returning id
    `);
    await db().execute(sql`
      insert into commerce.product_terms (store_id, product_id, content_type, term_id)
      select store_id, id, 'product', ${String(term.id)}::uuid from commerce.products
      where store_id = ${storeId}::uuid and handle = 'demo-notatbok'
    `);
    const [locales] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.product_translations t join commerce.products p on p.id = t.product_id
      where p.store_id = ${storeId}::uuid and p.handle = 'demo-notatbok'
    `);
    expect((await embeddings.refreshStoreEmbeddings(storeId)).embedded).toBe(Number(locales.n));
  });

  it("finds products by meaning that their words do not match", async () => {
    // No product says "drikke" or "te": keyword search finds nothing.
    expect(await search.matchingIds({ storeId, market: no }, "noe å drikke te av", 10, false)).toEqual([]);
    const ranked = await search.rankedSearch({ storeId, market: no }, "noe å drikke te av", 10, await meaningOf("noe å drikke te av"));
    // The mug, and nothing unrelated (the template may hold other drinks, such as coffee).
    expect(handles(ranked.ids)).toContain("demo-keramikkopp");
    expect(handles(ranked.ids).filter((h) => ["demo-bordlampe", "demo-hytte", "demo-notatbok", "demo-massasje"].includes(h!))).toEqual([]);
    expect(ranked.meaningOnly).toBe(ranked.ids.length);
    expect(ranked.semanticBest).toBeGreaterThan(0.9);

    // "Ferie ved sjøen" finds the cabin, not by its words.
    const cabin = await search.rankedSearch({ storeId, market: no }, "ferie ved sjøen", 10, await meaningOf("ferie ved sjøen"));
    expect(handles(cabin.ids)[0]).toBe("demo-hytte");
  });

  it("merges words and meaning, keeps nonsense empty, and leaves out what is below the store's limit", async () => {
    const both = await search.rankedSearch({ storeId, market: no }, "bordlampe", 10, await meaningOf("bordlampe"));
    expect(handles(both.ids)[0]).toBe("demo-bordlampe");
    expect(both.meaningOnly).toBe(0);

    const nonsense = await search.rankedSearch({ storeId, market: no }, "xyzzyqwv", 10, await meaningOf("xyzzyqwv"));
    expect(nonsense.ids).toEqual([]);
    // Still logged: how close the closest came, to set the limit by.
    expect(nonsense.semanticBest).not.toBeNull();
    expect(nonsense.semanticBest!).toBeLessThan(0.5);

    // With a low limit, only products near the closest come by meaning, not everything above the limit.
    const loose = { ...(await meaningOf("noe å drikke te av")), minSimilarity: 0 };
    const near = await search.rankedSearch({ storeId, market: no }, "noe å drikke te av", 10, loose);
    expect(handles(near.ids)).toContain("demo-keramikkopp");
    expect(handles(near.ids).filter((h) => ["demo-bordlampe", "demo-hytte", "demo-notatbok", "demo-massasje"].includes(h!))).toEqual([]);

    const strict = { ...(await meaningOf("noe å drikke te av")), minSimilarity: 0.999 };
    expect((await search.rankedSearch({ storeId, market: no }, "noe å drikke te av", 10, strict)).ids).toEqual([]);
  });

  it("never finds drafts, and never compares vectors of another model", async () => {
    await db().execute(sql`update commerce.products set status = 'draft' where store_id = ${storeId}::uuid and handle = 'demo-keramikkopp'`);
    try {
      const ranked = await search.rankedSearch({ storeId, market: no }, "noe å drikke te av", 10, await meaningOf("noe å drikke te av"));
      expect(handles(ranked.ids)).not.toContain("demo-keramikkopp");
    } finally {
      await db().execute(sql`update commerce.products set status = 'active' where store_id = ${storeId}::uuid and handle = 'demo-keramikkopp'`);
    }

    // A new model: the old vectors are not its, so meaning finds nothing until they are made again.
    const before = await meaningOf("noe å drikke te av");
    await ai.saveAiSettings(accountId, storeId, form({ ...ownAi, apiKey: "", embeddingModel: "mistral-embed-2" }));
    const after = await meaningOf("noe å drikke te av");
    expect(after.space).not.toBe(before.space);
    expect((await search.rankedSearch({ storeId, market: no }, "noe å drikke te av", 10, after)).ids).toEqual([]);
    const total = await vectorCount();
    expect((await embeddings.refreshStoreEmbeddings(storeId)).embedded).toBe(total);
    expect(handles((await search.rankedSearch({ storeId, market: no }, "noe å drikke te av", 10, after)).ids)).toContain("demo-keramikkopp");
  });

  it("searches by keyword alone when the AI fails, and says so when embedding fails", async () => {
    const failing = vi.fn(async () => {
      throw new ai.AiError("No answer within 1.5 seconds.");
    });
    const found = await search.searchProducts({ storeId, market: no }, "xyzzyqwv", failing);
    expect(failing).toHaveBeenCalledOnce();
    expect(found).toEqual({ products: [], semanticBest: null, meaningOnly: 0, filters: null });

    await db().execute(sql`update commerce.product_translations set description = description || ' Ny.' where store_id = ${storeId}::uuid and locale = 'nb-NO'`);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Rate limited" } }, { status: 429 })));
    const result = await embeddings.refreshStoreEmbeddings(storeId);
    expect(result).toEqual({ embedded: 0, failed: "Rate limited" });
  });

  it("logs how meaning did, for the store's search page", async () => {
    const shop = { storeId, market: no };
    await search.logSearch(shop, "noe å drikke te av", 1, { semanticBest: 0.97, meaningOnly: 1 });
    await search.logSearch(shop, "bordlampe", 1, { semanticBest: 0.99, meaningOnly: 0 });
    await search.logSearch(shop, "xyzzyqwv", 0, { semanticBest: 0.12, meaningOnly: 0 });
    await search.logSearch(shop, "uten ai", 0);
    const stats = await search.searchStats(storeId);
    expect(stats).toMatchObject({ searches: 4, meaningSearches: 3, meaningHelped: 1 });
    expect(stats.zero).toEqual(
      expect.arrayContaining([
        { query: "xyzzyqwv", count: 1, closest: expect.closeTo(0.12, 5) },
        { query: "uten ai", count: 1, closest: null },
      ]),
    );
  });
});
