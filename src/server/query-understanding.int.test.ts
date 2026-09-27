import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";
import { toMarket } from "@/lib/markets";
import { EVAL_CASES, type Expectation } from "@/lib/query-eval";
import { plainFilters, type SearchFilters, type UnderstandingContext } from "@/lib/query-understanding";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const understanding = await import("./query-understanding");
const search = await import("./search");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;
const handle = new Map<string, string>();

const context: UnderstandingContext = {
  locale: "nb-NO",
  currency: "NOK",
  currencyDigits: 2,
  categories: [{ slug: "belysning", name: "Belysning" }],
  tags: [],
};

function form(values: Record<string, string | boolean>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (value === true) data.set(name, "on");
    else if (value !== false) data.set(name, value);
  }
  return aiFormValues(data);
}

/** A text model that answers every request with `reply(query)`. */
function fakeModel(reply: (query: string) => string) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { messages } = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
      const query = messages.at(-1)!.content;
      asked.push(query);
      return Response.json({ choices: [{ message: { content: reply(query) } }] });
    }),
  );
  return asked;
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`understand-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`understand-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`understand-${run}@example.com`}`);
  accountId = String(account.id);
  for (const row of await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid`)) {
    handle.set(String(row.id), String(row.handle));
  }
  // The store's own AI, with a text model only.
  expect(
    await ai.saveAiSettings(accountId, storeId, form({ provider: "mistral", apiKey: "k", textModel: "mistral-small-latest", minSimilarity: "0.8", enabled: true })),
  ).toEqual({ ok: true });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => closeDb());

const shop = () => ({ storeId, market: no });
const handles = (ids: string[]) => ids.map((id) => handle.get(id)).sort();
const only = (filters: Partial<SearchFilters>): SearchFilters => ({ ...plainFilters(""), ...filters });

describe("query understanding (S3, D75)", () => {
  it("turns the model's answer into checked filters, and fails on anything else", async () => {
    const connection = (await ai.aiFor(storeId))!;
    fakeModel(() => 'Sure! ```json\n{"text": "lampe", "categories": ["belysning", "møbler"], "maxPrice": 500, "sort": "priceLow"}\n```');
    expect(await understanding.understandWith(connection, "billig lampe under 500 kr", context)).toEqual({
      ...plainFilters("lampe"),
      categories: ["belysning"],
      maxPriceMinor: 50000,
      sort: "priceLow",
    });
    fakeModel(() => "I cannot help with that.");
    await expect(understanding.understandWith(connection, "billig lampe", context)).rejects.toThrow(/did not answer with filters/);
  });

  it("finds what meets the filters with SQL: price, category and those below it, tag, kind and stock", async () => {
    // The template's demo products; browser tests may add others to it, which new stores copy.
    const list = async (filters: Partial<SearchFilters>) =>
      handles(await search.filteredIds(shop(), only(filters), 50)).filter((h) => h?.startsWith("demo-"));
    expect(await list({ maxPriceMinor: 15000 })).toEqual(["demo-notatbok", "demo-sykkelutleie"]);
    expect(await list({ minPriceMinor: 100000 })).toEqual(["demo-hytte"]);
    // "Hjem" holds the mug, and the lamp through "Belysning" below it.
    expect(await list({ categories: ["hjem"] })).toEqual(["demo-bordlampe", "demo-keramikkopp"]);
    expect(await list({ tags: ["nyhet"] })).toEqual(["demo-handlenett", "demo-notatbok"]);
    expect(await list({ kind: "stay" })).toEqual(["demo-hytte"]);
    // The lamp has none in stock; bookings count as available.
    expect(await list({ inStock: true })).not.toContain("demo-bordlampe");
    expect(await list({ inStock: true })).toContain("demo-hytte");
    expect(await list({ categories: ["hjem"], maxPriceMinor: 50000 })).toEqual(["demo-keramikkopp"]);
  });

  it("searches the words the filters leave, within the filters, and lists by filters alone when no words are left", async () => {
    const lamp = await search.rankedSearch(shop(), "lampe under 500 kr", 10, null, only({ text: "lampe", maxPriceMinor: 50000 }));
    expect(lamp.ids).toEqual([]);
    const cheap = await search.rankedSearch(shop(), "lampe under 1000 kr", 10, null, only({ text: "lampe", maxPriceMinor: 100000 }));
    expect(handles(cheap.ids)).toEqual(["demo-bordlampe"]);
    const filtersOnly = await search.rankedSearch(shop(), "nyheter", 10, null, only({ tags: ["nyhet"] }));
    expect(handles(filtersOnly.ids).filter((h) => h?.startsWith("demo-"))).toEqual(["demo-handlenett", "demo-notatbok"]);
  });

  it("asks the model only when a search may hold filters, never when asked for the exact words, and carries on without it", async () => {
    const understand = vi.fn(async () => only({ text: "xyzzy", maxPriceMinor: 500 }));
    const vectorFor = vi.fn(async () => [1]);

    // One plain word: no model call.
    expect(await search.searchProducts(shop(), "xyzzy", vectorFor, understand)).toMatchObject({ products: [], filters: null });
    expect(understand).not.toHaveBeenCalled();
    // No search model on this store: no vector either.
    expect(vectorFor).not.toHaveBeenCalled();

    const found = await search.searchProducts(shop(), "xyzzy under 5 kr", vectorFor, understand);
    expect(understand).toHaveBeenCalledWith(storeId, "mistral-small-latest", { locale: "nb-NO", currency: "NOK" }, "xyzzy under 5 kr");
    expect(found.filters).toEqual(only({ text: "xyzzy", maxPriceMinor: 500 }));

    // Exact words asked for: the page passes no `understand`.
    expect((await search.searchProducts(shop(), "xyzzy under 5 kr", vectorFor, null)).filters).toBeNull();

    const failing = vi.fn(async () => {
      throw new ai.AiError("No answer within 2.5 seconds.");
    });
    expect(await search.searchProducts(shop(), "xyzzy under 5 kr", vectorFor, failing)).toMatchObject({ products: [], filters: null });
  });

  it("logs what a search was understood as", async () => {
    const filters = only({ text: "lampe", maxPriceMinor: 50000 });
    await search.logSearch(shop(), "lampe under 500 kr", 0, { semanticBest: null, meaningOnly: 0, filters });
    const [row] = await db().execute<Row>(sql`
      select filters from commerce.search_queries where store_id = ${storeId}::uuid and query = 'lampe under 500 kr'
    `);
    expect(row.filters).toEqual(filters);
  });

  it("runs the eval: a model answering as the cases expect passes, one answering nothing does not", async () => {
    const connection = (await ai.aiFor(storeId))!;
    /** The model's JSON for a case's first reading. */
    const answerFor = (expected: Expectation) =>
      JSON.stringify({
        text: (expected.textHas ?? []).join(" "),
        categories: expected.categories ?? [],
        tags: expected.tags ?? [],
        minPrice: expected.minPriceMinor != null ? expected.minPriceMinor / 100 : null,
        maxPrice: expected.maxPriceMinor != null ? expected.maxPriceMinor / 100 : null,
        kind: expected.kind ?? null,
        inStock: expected.inStock ?? false,
        sort: expected.sort ?? "relevance",
      });
    const byQuery = new Map(EVAL_CASES.map((c) => [plainFilters(c.query).text, answerFor(c.accept[0])]));
    const asked = fakeModel((query) => byQuery.get(query) ?? "{}");
    const good = await understanding.runUnderstandingEval(connection);
    expect(asked).toHaveLength(EVAL_CASES.length);
    expect(good).toMatchObject({ model: "mistral-small-latest", passed: EVAL_CASES.length, total: EVAL_CASES.length, ok: true, failures: [] });

    fakeModel(() => "{}");
    const lazy = await understanding.runUnderstandingEval(connection);
    expect(lazy.ok).toBe(false);
    expect(lazy.failures.length).toBeGreaterThan(EVAL_CASES.length / 2);
    // Each failure shows what the model answered, to see why.
    expect(lazy.failures[0].answer).toBe("{}");
  });
});
