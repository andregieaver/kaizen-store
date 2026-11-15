import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { aiFormValues } from "@/lib/ai-provider";
import { toMarket } from "@/lib/markets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

/** Statements sent, and those naming the AI connection's table, by every executor the search reads with. */
const sent = vi.hoisted(() => ({ all: 0, providers: 0 }));

vi.mock("@/db/client", async (original) => {
  const real = await original<typeof import("@/db/client")>();
  /** A statement's text, from drizzle's chunks (parameters left out). */
  const textOf = (query: unknown): string => {
    if (!query || typeof query !== "object") return "";
    const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) return chunks.map(textOf).join("");
    const value = (query as { value?: unknown }).value;
    return Array.isArray(value) ? value.join("") : typeof value === "string" ? value : "";
  };
  const counted = <T extends object>(executor: T): T =>
    new Proxy(executor, {
      get(target, property, receiver) {
        if (property === "execute")
          return (query: unknown) => {
            sent.all += 1;
            if (textOf(query).includes("ai_providers")) sent.providers += 1;
            return (target as unknown as { execute: (q: unknown) => unknown }).execute(query);
          };
        return Reflect.get(target, property, receiver);
      },
    });
  return { ...real, db: () => counted(real.db()), readDb: () => counted(real.readDb()) };
});

const { closeDb, db } = await import("@/db/client");
const ai = await import("./ai");
const search = await import("./search");
const { understandQuery } = await import("./query-understanding");
const { queryVector } = await import("./query-vector");
const { forgetSearchTokens } = await import("./search-budget");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
const handle = new Map<string, string>();

/** The store's model, stubbed: vectors for `/embeddings`, plain filters for `/chat/completions`; each call counted by kind. */
const calls = { vectors: 0, understandings: 0 };
function fakeModel() {
  calls.vectors = 0;
  calls.understandings = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input?: string[] };
      if (String(url).endsWith("/embeddings")) {
        calls.vectors += 1;
        return Response.json({ data: (body.input ?? []).map((_, index) => ({ index, embedding: [1, 0, 0, 0] })) });
      }
      calls.understandings += 1;
      return Response.json({ choices: [{ message: { content: '{"text": "kopp"}' } }] });
    }),
  );
}

const shop = () => ({ storeId, market: no });
const vectorFor = (store: string, space: string, text: string, visitor: string | null) => queryVector(store, space, text, "search", visitor);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`search-budget-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`search-budget-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`search-budget-${run}@example.com`}`);
  for (const row of await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid`)) handle.set(String(row.id), String(row.handle));
  // The store's own AI with a search model and a text model: its own key is under the same ceiling as Kaizena Flow's, and Kaizena
  // Flow's provider (one row for every test) stays as it is.
  const data = new FormData();
  for (const [name, value] of Object.entries({ provider: "mistral", apiKey: "store-key", embeddingModel: "mistral-embed", textModel: "mistral-small-latest", minSimilarity: "0.5", enabled: "on" })) {
    data.set(name, value);
  }
  expect(await ai.saveAiSettings(String(account.id), storeId, aiFormValues(data))).toEqual({ ok: true });
});

beforeEach(() => fakeModel());

afterAll(async () => {
  vi.unstubAllGlobals();
  await db().execute(sql`delete from commerce.ai_providers where store_id = ${storeId}::uuid`);
  await closeDb();
});

const minuteOf = () => Math.floor(Date.now() / 60_000);

describe("the search's ceiling on the AI (bloat review 0.21)", () => {
  it("lets one visitor's 200 new searches in a minute make at most the budget's model calls, and answers every one", async () => {
    const visitor = `visitor-${run}`;
    const started = minuteOf();
    let answered = 0;
    for (let i = 0; i < 200; i += 1) {
      const found = await search.searchProducts(shop(), `kopp nummer ${i}`, vectorFor, understandQuery, 12, visitor);
      if (Array.isArray(found.products)) answered += 1;
    }
    // A run that crosses into the next minute has that minute's budget too.
    const minutes = minuteOf() - started + 1;
    expect(answered).toBe(200);
    expect(calls.vectors).toBeGreaterThan(0);
    expect(calls.understandings).toBeGreaterThan(0);
    expect(calls.vectors).toBeLessThanOrEqual(20 * minutes);
    expect(calls.understandings).toBeLessThanOrEqual(20 * minutes);
    expect(calls.vectors + calls.understandings).toBeLessThanOrEqual(20 * minutes);
  }, 180_000);

  it("reads no AI connection for a search answered from the cache", async () => {
    const visitor = `again-${run}`;
    await search.searchProducts(shop(), "blå kopp med hank 2", vectorFor, understandQuery, 12, visitor);
    expect(calls.vectors).toBe(1);
    expect(calls.understandings).toBe(1);
    sent.all = 0;
    sent.providers = 0;
    const again = await search.searchProducts(shop(), "blå kopp med hank 2", vectorFor, understandQuery, 12, visitor);
    expect(Array.isArray(again.products)).toBe(true);
    expect(sent.all).toBeGreaterThan(0);
    expect(sent.providers).toBe(0);
    // Both answers came from the cache: no model call either.
    expect(calls.vectors).toBe(1);
    expect(calls.understandings).toBe(1);
  });

  it("makes no model call past the month's search tokens, and still answers by keyword", async () => {
    await db().execute(sql`
      insert into commerce.ai_usage (store_id, source, provider, model, kind, feature, input_tokens, output_tokens)
      values (${storeId}::uuid, 'store', 'mistral', 'mistral-small-latest', 'text', 'search', 900000, 100001)
    `);
    forgetSearchTokens(storeId);
    const found = await search.searchProducts(shop(), "keramikkopp", vectorFor, understandQuery, 12, `capped-${run}`);
    expect(calls.vectors + calls.understandings).toBe(0);
    expect(found.products.map((p) => handle.get(p.id))).toContain("demo-keramikkopp");
  });
});
