import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const cache = await import("./search-cache");
const { queryVector } = await import("./query-vector");

const run = Date.now().toString(36);
let storeId: string;
let accountId: string;

function save(embeddingModel: string) {
  const data = new FormData();
  for (const [name, value] of Object.entries({ provider: "mistral", apiKey: "k", embeddingModel, minSimilarity: "0.3", enabled: "on" })) {
    data.set(name, value);
  }
  return ai.saveAiSettings(accountId, storeId, aiFormValues(data));
}

/** A search model answering [1, 2, 3], counting its calls. */
function fakeModel() {
  const calls = { n: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls.n += 1;
      return Response.json({ data: [{ index: 0, embedding: [1, 2, 3] }] });
    }),
  );
  return calls;
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`cache-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`cache-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`cache-${run}@example.com`}`);
  accountId = String(account.id);
  expect(await save("mistral-embed")).toEqual({ ok: true });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => closeDb());

describe("search cache (D74, D75)", () => {
  it("asks the model once per search and model, for every server instance", async () => {
    const space = (await ai.aiFor(storeId))!.space!;
    const calls = fakeModel();
    expect(await queryVector(storeId, space, "kopp til te")).toEqual([1, 2, 3]);
    expect(await queryVector(storeId, space, "kopp til te")).toEqual([1, 2, 3]);
    expect(calls.n).toBe(1);
    await queryVector(storeId, space, "annen kopp");
    expect(calls.n).toBe(2);

    // A new model is another space: asked again, and the old space's vector is not given for it.
    await save("mistral-embed-2");
    const next = (await ai.aiFor(storeId))!.space!;
    await queryVector(storeId, next, "kopp til te");
    expect(calls.n).toBe(3);
    // A search still holding the old space is refused rather than served an old model's answer anew.
    await expect(queryVector(storeId, `${space}-gone`, "ny søk")).rejects.toThrow(/search model changed/);
  });

  it("keeps no failures, and forgets answers after 30 days", async () => {
    let tries = 0;
    await expect(
      cache.cached(storeId, "filters", cache.cacheKey("x"), async () => {
        tries += 1;
        throw new Error("model down");
      }),
    ).rejects.toThrow("model down");
    expect(await cache.cached(storeId, "filters", cache.cacheKey("x"), async () => ({ text: "kopp" }))).toEqual({ text: "kopp" });
    expect(tries).toBe(1);

    await db().execute(sql`update commerce.search_cache set created_at = now() - interval '31 days' where store_id = ${storeId}::uuid`);
    // Too old to use, and pruned.
    expect(await cache.cached(storeId, "filters", cache.cacheKey("x"), async () => ({ text: "ny" }))).toEqual({ text: "ny" });
    expect(await cache.pruneSearchCache()).toBeGreaterThanOrEqual(2);
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.search_cache where store_id = ${storeId}::uuid`);
    expect(left.n).toBe(1);
  });
});
