import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { AiConnection } from "./ai";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

/**
 * The site's AI as the test sets it: a stand-in whose "vectors" put the returns passage at one direction and each question at a chosen
 * cosine similarity to it (1, 0.5 or 0.2), so the floor is tested on the database's own distance (`<=>`) without a provider.
 */
let site: AiConnection | null = null;
const RETURNS = [1, 0, 0];
const AT: Record<string, number[]> = {
  "can I send it back": [0.95, Math.sqrt(1 - 0.95 ** 2), 0],
  "how do I exchange a gift": [0.5, Math.sqrt(1 - 0.5 ** 2), 0],
  "bicycle helmet sizes": [0.2, Math.sqrt(1 - 0.2 ** 2), 0],
  returnere: [0.2, Math.sqrt(1 - 0.2 ** 2), 0],
};
const toyVector = (text: string) => AT[text] ?? (text.startsWith("Returns\n") ? RETURNS : [0, 0, 1]);
vi.mock("./ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai")>()),
  aiFor: async () => site,
  embedTexts: async (_connection: AiConnection, texts: string[]) => ({ vectors: texts.map(toyVector), region: null }),
}));

const { makeStore } = await import("./trust-fixtures");
const knowledge = await import("./knowledge");

let storeId: string;
const toy = (minSimilarity: number) => ({ provider: "openai", source: "store", apiUrl: "https://ai.example", apiKey: "k", space: "toy|3", embeddingModel: "toy", minSimilarity }) as unknown as AiConnection;

beforeAll(async () => {
  const made = await makeStore("floor");
  storeId = made.id;
  const saved = await knowledge.saveDocument(made.account, storeId, null, { title: "Returns", content: "Du kan returnere varer innen 30 dager." });
  expect(saved.ok).toBe(true);
  site = toy(0.3);
  expect((await knowledge.embedKnowledge(storeId, site)).embedded).toBe(1);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.knowledge_documents where store_id = ${storeId}::uuid`);
  await closeDb();
});

const titles = async (query: string) => (await knowledge.searchKnowledge(storeId, query, "en-GB")).map((p) => p.title);

describe("the knowledge search's relevance floor by meaning (ecosystem plan E5.4, D757)", () => {
  it("finds a passage close in meaning whose words the question does not hold", async () => {
    site = toy(0.3);
    expect(await titles("can I send it back")).toEqual(["Returns"]);
    expect(await titles("how do I exchange a gift")).toEqual(["Returns"]);
  });

  it("finds nothing when the nearest passage is below the site's limit, so the chat says so and the question counts", async () => {
    site = toy(0.3);
    // Similarity 0.2 (distance 0.8): it came back before as the nearest there was.
    expect(await titles("bicycle helmet sizes")).toEqual([]);
  });

  it("follows the site's own limit, set for its model", async () => {
    // A model that scores everything higher (mistral-embed) is given a higher limit: 0.5 is then too far.
    site = toy(0.75);
    expect(await titles("can I send it back")).toEqual(["Returns"]);
    expect(await titles("how do I exchange a gift")).toEqual([]);
  });

  it("leaves the keyword search as it was: a passage that holds the words is found however far its meaning", async () => {
    site = toy(0.3);
    expect(await titles("returnere")).toEqual(["Returns"]);
    // Without AI the search is by its words alone.
    site = null;
    expect(await titles("returnere")).toEqual(["Returns"]);
    expect(await titles("can I send it back")).toEqual([]);
  });
});
