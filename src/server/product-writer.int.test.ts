import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";
import { productFacts, writeRequest, writtenFindings } from "@/lib/product-writing";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const writer = await import("./product-writer");

const run = Date.now().toString(36);
let storeId: string;
let accountId: string;

const facts = productFacts.parse({
  kind: "goods",
  title: "Keramikkopp",
  description: "Kopp i steingods. Tåler oppvaskmaskin.",
  categories: ["Kjøkken"],
});

/** A text model answering `reply`, keeping what it was sent. */
function fakeModel(reply: string) {
  const sent: { messages: { role: string; content: string }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ choices: [{ message: { content: reply } }] });
    }),
  );
  return sent;
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`writer-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`writer-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`writer-${run}@example.com`}`);
  accountId = String(account.id);
  const data = new FormData();
  for (const [name, value] of Object.entries({ provider: "mistral", apiKey: "k", textModel: "mistral-small-latest", minSimilarity: "0.3", enabled: "on" })) {
    data.set(name, value);
  }
  expect(await ai.saveAiSettings(accountId, storeId, aiFormValues(data))).toEqual({ ok: true });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => closeDb());

describe("AI product texts (S4, D76)", () => {
  it("suggests plain text from the product's facts, and logs who asked, never the text", async () => {
    const connection = (await ai.aiFor(storeId))!;
    const sent = fakeModel('```json\n{"description": "<p>En **solid** kopp i steingods.</p>\\n\\nTåler oppvaskmaskin."}\n```');
    const request = writeRequest.parse({ kind: "write", language: "Norwegian Bokmål", facts });
    const result = await writer.suggestProductText(connection, { accountId, storeId, productId: null }, request);
    expect(result).toEqual({ written: { description: "En solid kopp i steingods.\n\nTåler oppvaskmaskin." }, model: "mistral-small-latest" });
    // The model got the facts, not a price or a stock level.
    expect(sent[0].messages[1].content).toContain("Keramikkopp");
    expect(sent[0].messages[1].content).not.toMatch(/\d+ ?kr|stock|lager/i);

    const [log] = await db().execute<Row>(sql`
      select action, details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'product.ai_suggested'
      order by created_at desc limit 1
    `);
    expect(log.details).toEqual({ productId: null, kind: "write", language: "Norwegian Bokmål", model: "mistral-small-latest", source: "store" });
    expect(JSON.stringify(log.details)).not.toContain("steingods");
  });

  it("translates the fields given, and leaves the claims for staff to take out", async () => {
    const connection = (await ai.aiFor(storeId))!;
    fakeModel('{"title": "Keramikmugg", "description": "En miljövänlig mugg, endast 199 kr – bästa pris!"}');
    const request = writeRequest.parse({ kind: "translate", language: "Swedish", fromLanguage: "Norwegian Bokmål", facts });
    const { written } = await writer.suggestProductText(connection, { accountId, storeId, productId: null }, request);
    expect(written.title).toBe("Keramikmugg");
    // Returned as written; the editor will not let it be used until these are gone.
    expect(writtenFindings(written).description?.map((f) => f.kind)).toEqual(["green", "price", "bestPrice"]);
  });

  it("fails clearly when the answer is not the texts asked for", async () => {
    const connection = (await ai.aiFor(storeId))!;
    fakeModel('{"title": "Only a title"}');
    const request = writeRequest.parse({ kind: "translate", language: "Swedish", fromLanguage: "Norwegian Bokmål", facts });
    await expect(writer.suggestProductText(connection, { accountId, storeId, productId: null }, request)).rejects.toThrow(
      /did not answer with the texts asked for/,
    );
  });
});
