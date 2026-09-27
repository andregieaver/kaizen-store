import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");

const run = Date.now().toString(36);
let storeId: string;
let accountId: string;

/** The settings form as a platform admin or owner would fill it in. */
function form(values: Record<string, string | boolean>): ReturnType<typeof aiFormValues> {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (value === true) data.set(name, "on");
    else if (value !== false) data.set(name, value);
  }
  return aiFormValues(data);
}

const kaizen = {
  provider: "gateway",
  apiKey: "vck_kaizen_secret_1111",
  embeddingModel: "mistral/mistral-embed",
  textModel: "anthropic/claude-haiku-4.5",
  minSimilarity: "0.8",
  textEuOnly: true,
  zeroDataRetention: true,
  enabled: true,
};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`ai-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`ai-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`ai-${run}@example.com`}`);
  accountId = String(account.id);
  // Kaizen's provider is one row for the whole platform: start from none.
  await ai.removeAiSettings(accountId, null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await ai.removeAiSettings(accountId, null);
  await closeDb();
});

/** Answers every request with `body` and keeps what was asked. */
function fakeProvider(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit; body: Row }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init, body: JSON.parse(String(init.body)) as Row });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

describe("AI providers (D73)", () => {
  it("gives stores Kaizen's AI, or their own while it is on", async () => {
    expect(await ai.aiFor(storeId)).toBeNull();
    expect(await ai.saveAiSettings(accountId, null, form(kaizen))).toEqual({ ok: true });

    const platform = await ai.aiFor(storeId);
    expect(platform).toMatchObject({
      source: "platform",
      provider: "gateway",
      apiUrl: "https://ai-gateway.vercel.sh/v1",
      apiKey: kaizen.apiKey,
      embeddingModel: "mistral/mistral-embed",
      space: "ai-gateway.vercel.sh/v1|mistral/mistral-embed",
    });

    const own = { provider: "mistral", apiKey: "store-key-2222", embeddingModel: "mistral-embed", minSimilarity: "0.75", enabled: true };
    expect(await ai.saveAiSettings(accountId, storeId, form(own))).toEqual({ ok: true });
    expect(await ai.aiFor(storeId)).toMatchObject({
      source: "store",
      apiUrl: "https://api.mistral.ai/v1",
      apiKey: own.apiKey,
      textModel: null,
      minSimilarity: 0.75,
      space: "api.mistral.ai/v1|mistral-embed",
    });
    // Other stores keep Kaizen's.
    expect((await ai.aiFor(null))?.source).toBe("platform");

    // Switched off, the store is back on Kaizen's; Kaizen's off too, no AI.
    await ai.saveAiSettings(accountId, storeId, form({ ...own, apiKey: "", enabled: false }));
    expect((await ai.aiFor(storeId))?.source).toBe("platform");
    await ai.saveAiSettings(accountId, null, form({ ...kaizen, apiKey: "", enabled: false }));
    expect(await ai.aiFor(storeId)).toBeNull();
    await ai.saveAiSettings(accountId, null, form({ ...kaizen, apiKey: "" }));

    await ai.removeAiSettings(accountId, storeId);
    expect(await ai.getAiSettings(storeId)).toBeNull();
    const [logged] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action like 'ai.%'
    `);
    // Saved, switched off, removed; Kaizen's own changes are logged without a store.
    expect(logged.n).toBe(3);
  });

  it("keeps the key encrypted and never shows it; an empty key keeps the saved one", async () => {
    const settings = await ai.getAiSettings(null);
    expect(settings).toMatchObject({ apiKeyHint: "…1111", provider: "gateway" });
    expect(JSON.stringify(settings)).not.toContain(kaizen.apiKey);
    const [row] = await db().execute<Row>(sql`select api_key_encrypted from commerce.ai_providers where store_id is null`);
    expect(String(row.api_key_encrypted)).not.toContain(kaizen.apiKey);

    // Another provider needs its own key.
    const moved = await ai.saveAiSettings(accountId, storeId, form({ provider: "openai", embeddingModel: "text-embedding-3-small", minSimilarity: "0.5" }));
    expect(moved).toEqual({ ok: false, problems: ["Paste an API key for OpenAI."] });
    const custom = await ai.saveAiSettings(
      accountId,
      storeId,
      form({ provider: "custom", baseUrl: "https://169.254.169.254/v1", apiKey: "x", textModel: "llama", minSimilarity: "0.5" }),
    );
    expect(custom.ok).toBe(false);
  });

  it("asks the gateway for EU data centres and zero retention, as set, and reads the vectors in order", async () => {
    const connection = (await ai.aiFor(storeId))!;
    const calls = fakeProvider({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });
    const result = await ai.embedTexts(connection, ["a", "b"]);
    expect(result.vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(calls[0].url).toBe("https://ai-gateway.vercel.sh/v1/embeddings");
    expect(calls[0].init).toMatchObject({ method: "POST", redirect: "error" });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${kaizen.apiKey}`);
    // No embedding model can be pinned to the EU yet, so only zero retention.
    expect(calls[0].body).toEqual({ model: "mistral/mistral-embed", input: ["a", "b"], providerOptions: { gateway: { zeroDataRetention: true } } });

    const chat = fakeProvider({ choices: [{ message: { content: "OK" } }] });
    expect((await ai.completeText(connection, [{ role: "user", content: "Hi" }], { maxTokens: 5 })).text).toBe("OK");
    expect(chat[0].url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
    expect(chat[0].body).toMatchObject({
      model: "anthropic/claude-haiku-4.5",
      max_tokens: 5,
      providerOptions: { gateway: { inferenceRegion: { scope: "zone", geoRegion: "eu" }, zeroDataRetention: true } },
    });
  });

  it("sends other providers plain OpenAI-compatible requests, and reports their errors", async () => {
    await ai.saveAiSettings(
      accountId,
      storeId,
      form({ provider: "openai", apiKey: "sk-store-3333", embeddingModel: "text-embedding-3-small", textModel: "gpt-5-mini", minSimilarity: "0.4", enabled: true }),
    );
    const connection = (await ai.aiFor(storeId))!;
    const calls = fakeProvider({ choices: [{ message: { content: "OK" } }] });
    await ai.completeText(connection, [{ role: "user", content: "Hi" }], { maxTokens: 5 });
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].body).toEqual({ model: "gpt-5-mini", messages: [{ role: "user", content: "Hi" }], max_completion_tokens: 5 });

    fakeProvider({ error: { message: "Invalid API key" } }, 401);
    await expect(ai.embedTexts(connection, ["a"])).rejects.toMatchObject({ name: "AiError", status: 401, message: "Invalid API key" });
    fakeProvider({ data: [] });
    await expect(ai.embedTexts(connection, ["a"])).rejects.toThrow(/one vector per text/);

    // OpenAI's EU address refuses keys from projects without EU data residency: say what to do.
    const geography = { error: { message: "This endpoint is only accessible by projects with geography restrictions enabled." } };
    fakeProvider(geography, 401);
    await expect(ai.embedTexts({ ...connection, provider: "openai_eu" }, ["a"])).rejects.toThrow(/without European data residency/);
    fakeProvider(geography, 401);
    await expect(ai.embedTexts(connection, ["a"])).rejects.toThrow(/geography restrictions/);
    await ai.removeAiSettings(accountId, storeId);
  });

  it("asks again without tuning a model refuses, and says when an answer was cut off", async () => {
    const connection = (await ai.ownConnection(null))!;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        return "temperature" in body
          ? Response.json({ error: { message: "Unsupported value: 'temperature' does not support 0 with this model." } }, { status: 400 })
          : Response.json({ choices: [{ message: { content: "OK" } }] });
      }),
    );
    const reply = await ai.completeText(connection, [{ role: "user", content: "Hi" }], { temperature: 0, reasoningEffort: "low" });
    expect(reply.text).toBe("OK");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ temperature: 0, reasoning_effort: "low" });
    // Only what was refused is left out, and the model is not asked with it again.
    expect(bodies[1]).not.toHaveProperty("temperature");
    expect(bodies[1]).toMatchObject({ reasoning_effort: "low" });
    await ai.completeText(connection, [{ role: "user", content: "Hi" }], { temperature: 0, reasoningEffort: "low" });
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty("temperature");

    // A model that knows neither gets there too.
    const other = { ...connection, textModel: "plain-model" };
    const plain: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        plain.push(body);
        if ("reasoning_effort" in body) return Response.json({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } }, { status: 400 });
        if ("temperature" in body) return Response.json({ error: { message: "Unsupported parameter: 'temperature'" } }, { status: 400 });
        return Response.json({ choices: [{ message: { content: "OK" } }] });
      }),
    );
    expect((await ai.completeText(other, [{ role: "user", content: "Hi" }], { temperature: 0, reasoningEffort: "low" })).text).toBe("OK");
    expect(plain).toHaveLength(3);

    // Other refusals are not asked again.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Invalid model" } }, { status: 400 })));
    await expect(ai.completeText(connection, [{ role: "user", content: "Hi" }], { temperature: 0 })).rejects.toThrow("Invalid model");

    // A reasoning model that thought until the limit gives no text.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "" }, finish_reason: "length" }] })));
    await expect(ai.completeText(connection, [{ role: "user", content: "Hi" }])).rejects.toThrow(/cut off at its length limit/);
  });

  it("tests both models from the admin, with scores to set the similarity by", async () => {
    const connection = (await ai.ownConnection(null))!;
    const vectors = [
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0, 0, 1],
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/embeddings") ? { data: vectors.map((embedding, index) => ({ index, embedding })) } : { choices: [{ message: { content: "OK" } }] }),
      ),
    );
    const result = await ai.testAi(connection);
    expect(result.embedding).toMatchObject({ ok: true });
    expect(result.embedding?.message).toMatch(/matching product scored 0\.99, an unrelated one 0\.00 \(limit 0\.80\)/);
    expect(result.text?.message).toMatch(/answered in \d+ ms: “OK”/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bad Gateway", { status: 502 })));
    expect((await ai.testAi(connection)).text).toEqual({ ok: false, message: "anthropic/claude-haiku-4.5: 502: Bad Gateway" });
  });
});
