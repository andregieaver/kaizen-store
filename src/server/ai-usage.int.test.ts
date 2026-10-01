import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { groupUsage, totalOf, withModel, withOwner, withStore } from "@/lib/ai-usage";

import type { AiConnection } from "./ai";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const usage = await import("./ai-usage");

type Row = Record<string, unknown>;
// Tool answers are loose JSON, read field by field here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

const run = Date.now().toString(36);
const stores: { id: string; slug: string; owner: string }[] = [];

async function makeStore(name: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`usage-${name}-${run}@example.com`}, ${name}, ${name}) returning id
  `);
  const slug = `usage-${name}-${run}`;
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`usage-${name}-${run}@example.com`}`);
  stores.push({ id: String(store.id), slug, owner: String(owner.id) });
  return stores.at(-1)!;
}

let one: (typeof stores)[number];
let two: (typeof stores)[number];

beforeAll(async () => {
  one = await makeStore("uno");
  two = await makeStore("duo");
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await db().execute(sql`delete from commerce.ai_usage where store_id in (${stores[0].id}::uuid, ${stores[1].id}::uuid) or store_id is null`);
  await closeDb();
});

const connection = (storeId: string | null, source: "platform" | "store", feature: "search" | "ai_manager" = "search", extra: Partial<AiConnection> = {}) =>
  ({
    provider: "openai",
    apiUrl: "https://ai.example/v1",
    apiKey: "sk-test",
    source,
    textModel: "text-a",
    embeddingModel: "embed-a",
    transcriptionModel: "hear-a",
    speechModel: "speak-a",
    speechVoice: "warm",
    textEuOnly: false,
    embeddingEuOnly: false,
    zeroDataRetention: false,
    image: { provider: "openai", apiUrl: "https://ai.example/v1", apiKey: "sk-test", model: "picture-a", quality: null },
    usage: { storeId, feature, accountId: null },
    ...extra,
  }) as unknown as AiConnection;

const answer = (body: unknown) => Response.json(body);
const stub = (...answers: Response[]) => vi.stubGlobal("fetch", vi.fn(async () => answers.shift() ?? answer({})));

describe("AI usage (D106)", () => {
  it("records each kind of call with what the provider said it used, and counts when it said nothing", async () => {
    stub(
      answer({ choices: [{ message: { content: "Hei" } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }),
      answer({ data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { prompt_tokens: 7, total_tokens: 7 } }),
      answer({ choices: [{ message: { content: "Uten tall i svaret" } }] }),
      answer({ text: "hallo", usage: { type: "duration", seconds: 4 } }),
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
      answer({ data: [{ b64_json: Buffer.from("png").toString("base64") }], usage: { input_tokens: 40, output_tokens: 900 } }),
    );
    const c = connection(one.id, "platform", "ai_manager");
    await ai.completeText(c, [{ role: "user", content: "Hei" }]);
    await ai.embedTexts(c, ["lampe"]);
    await ai.completeText(c, [{ role: "user", content: "x".repeat(400) }]);
    await ai.transcribeAudio(c, new Blob([new Uint8Array(2000)]), "a.webm", null);
    await ai.speakText(c, "Hei, hvordan går det?");
    await ai.generateImage(c, "en kopp");

    const rows = await db().execute<Row>(sql`
      select kind, provider, model, source, feature, owner_account_id, requests, failed, input_tokens, output_tokens, characters, audio_bytes, audio_seconds, images, estimated
      from commerce.ai_usage where store_id = ${one.id}::uuid order by created_at, kind
    `);
    const by = (kind: string, estimated = false) => rows.find((r) => r.kind === kind && r.estimated === estimated)!;
    expect(rows).toHaveLength(6);
    expect(by("text")).toMatchObject({ provider: "openai", model: "text-a", source: "platform", feature: "ai_manager", owner_account_id: one.owner, input_tokens: 120, output_tokens: 30 });
    expect(by("embedding")).toMatchObject({ model: "embed-a", input_tokens: 7 });
    // No numbers from the provider: counted, about four characters a token, and marked.
    expect(by("text", true)).toMatchObject({ input_tokens: 100, output_tokens: 5 });
    expect(by("transcription")).toMatchObject({ model: "hear-a", audio_bytes: 2000, audio_seconds: 4 });
    expect(by("speech")).toMatchObject({ model: "speak-a", characters: 21 });
    expect(by("image")).toMatchObject({ model: "picture-a", images: 1, input_tokens: 40, output_tokens: 900 });
  });

  it("records a refused call as a failed request, and a call tried again only once", async () => {
    stub(new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }));
    await expect(ai.completeText(connection(two.id, "store"), [{ role: "user", content: "Hei" }])).rejects.toThrow("quota");
    // A model that refuses `temperature` is asked again without it: one request in the log.
    stub(
      new Response(JSON.stringify({ error: { message: "temperature is not supported" } }), { status: 400 }),
      answer({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }),
    );
    await ai.completeText(connection(two.id, "store", "search", { textModel: "text-b" }), [{ role: "user", content: "Hei" }], { temperature: 0 });
    const rows = await db().execute<Row>(sql`select model, source, requests, failed, input_tokens from commerce.ai_usage where store_id = ${two.id}::uuid order by model`);
    expect(rows).toEqual([
      { model: "text-a", source: "store", requests: 1, failed: 1, input_tokens: 0 },
      { model: "text-b", source: "store", requests: 1, failed: 0, input_tokens: 5 },
    ]);
  });

  it("takes the tokens of a streamed answer from its last chunk, and records nothing for a connection made for no one", async () => {
    const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const body = chunk({ choices: [{ delta: { content: "Hallo" } }] }) + chunk({ choices: [], usage: { prompt_tokens: 60, completion_tokens: 12 } }) + "data: [DONE]\n\n";
    const fetchSpy = vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchSpy);
    await ai.streamWithTools(connection(null, "platform", "ai_manager"), [{ role: "user", content: "Hei" }], [], () => {});
    // Asked to say what it used, as this provider takes it.
    expect(JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body)).stream_options).toEqual({ include_usage: true });
    const [platform] = await db().execute<Row>(sql`
      select input_tokens, output_tokens, owner_account_id, store_id from commerce.ai_usage where store_id is null and feature = 'ai_manager' order by created_at desc limit 1
    `);
    expect(platform).toMatchObject({ input_tokens: 60, output_tokens: 12, owner_account_id: null, store_id: null });

    const before = await db().execute<Row>(sql`select count(*)::int as n from commerce.ai_usage`);
    stub(answer({ choices: [{ message: { content: "Hei" } }] }));
    await ai.completeText({ ...connection(one.id, "platform"), usage: undefined }, [{ role: "user", content: "Hei" }]);
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.ai_usage`))[0].n).toBe(before[0].n);
  });

  it("adds a live call's length to the row its start made, only for its own person and only once", async () => {
    await usage.recordUsage({ storeId: one.id, feature: "ai_manager", accountId: one.owner }, { source: "store", provider: "openai", model: "live-a", kind: "live", sessionRef: `sess-${run}` });
    await usage.recordLiveSeconds(two.owner, one.id, `sess-${run}`, 90);
    await usage.recordLiveSeconds(one.owner, one.id, `sess-${run}`, 125.4);
    await usage.recordLiveSeconds(one.owner, one.id, `sess-${run}`, 999);
    const [call] = await db().execute<Row>(sql`select audio_seconds, requests from commerce.ai_usage where session_ref = ${`sess-${run}`}`);
    expect(call).toEqual({ audio_seconds: 125, requests: 1 });
  });

  it("reports the period as rows that sum up per provider and model, per owner and per store, for the platform and for one owner", async () => {
    const platform = await usage.usageRows({ days: 30 });
    const mine = platform.filter((r) => r.storeId === one.id || r.storeId === two.id);
    expect(new Set(mine.map((r) => r.ownerId))).toEqual(new Set([one.owner, two.owner]));

    const perStore = groupUsage(mine, withStore);
    expect(perStore.map((g) => g.sub).sort()).toEqual([one.slug, two.slug].sort());
    const uno = perStore.find((g) => g.sub === one.slug)!;
    expect(uno.sums.requests).toBe(7);
    expect(uno.sums.images).toBe(1);
    expect(uno.sums.estimatedRequests).toBe(1);
    expect(groupUsage(uno.rows, withModel).map((g) => g.label)).toEqual(expect.arrayContaining(["text-a", "embed-a", "picture-a", "live-a"]));
    // Who paid stays apart: the second store's own key.
    expect(mine.filter((r) => r.storeId === two.id).every((r) => r.source === "store")).toBe(true);
    expect(totalOf(mine).requests).toBe(uno.sums.requests + perStore.find((g) => g.sub === two.slug)!.sums.requests);
    expect(groupUsage(mine, withOwner).find((g) => g.key === two.owner)).toMatchObject({ sums: { requests: 2, failed: 1 } });

    // An owner sees only stores they own.
    const owned = await usage.usageRows({ days: 30, ownedBy: two.owner });
    expect(owned.every((r) => r.ownerId === two.owner && r.storeId === two.id)).toBe(true);
    expect(totalOf(owned).requests).toBe(2);
    expect(await usage.usageRows({ days: 30, ownedBy: two.owner, storeId: one.id })).toEqual([]);

    const days = await usage.usageByDay({ days: 7, ownedBy: one.owner });
    expect(days).toHaveLength(7);
    expect(days.reduce((n, d) => n + d.requests, 0)).toBe(7);
  });

  it("answers the AI manager from the same rows, for an owner's store and for the platform", async () => {
    const tools = await import("./owner-tools");
    const manager = await import("./manager-tools");
    const stores2 = await import("./stores");
    const store = (await stores2.getStore(two.slug))!;
    const account = { id: two.owner, email: `usage-duo-${run}@example.com`, name: "Duo", platformAdmin: false };
    const own = (await tools.runOwnerTool({ account, store, invalidate: () => {} }, "ai_usage", { days: 30 })) as Answer;
    expect(own.covers).toBe("duo");
    expect(own.total).toMatchObject({ requests: 2, failed: 1 });
    expect(own.on_kaizens_key).toEqual({ requests: 0, tokens: 0, estimated_cost_usd: 0 });
    expect(own.by_provider_and_model.map((m: { model: string }) => m.model).sort()).toEqual(["text-a", "text-b"]);
    // Not another owner's store.
    const other = { ...account, id: one.owner };
    const theirs = (await tools.runOwnerTool({ account: other, store, invalidate: () => {} }, "ai_usage", { days: 30 })) as Answer;
    expect(theirs.total.requests).toBe(0);

    const admin = { ...account, platformAdmin: true };
    const ctx = { account: admin, store: null, flags: {}, connection: null, navigate: () => {}, invalidate: () => {} };
    const all = (await manager.runPlatformTool(ctx, "platform_ai_usage", { days: 30, store: one.slug })) as Answer;
    expect(all.total.requests).toBe(7);
    expect(all.by_store_owner_account).toEqual([expect.objectContaining({ email: `usage-uno-${run}@example.com` })]);
    await expect(manager.runPlatformTool({ ...ctx, account }, "platform_ai_usage", { days: 30 })).rejects.toThrow("Only platform admins");
  });

  it("forgets usage older than the kept days", async () => {
    await db().execute(sql`
      insert into commerce.ai_usage (store_id, source, provider, model, kind, created_at)
      values (${one.id}::uuid, 'platform', 'openai', 'old-model', 'text', now() - interval '401 days')
    `);
    expect(await usage.pruneUsage()).toBeGreaterThanOrEqual(1);
    expect(await db().execute(sql`select 1 from commerce.ai_usage where model = 'old-model'`)).toHaveLength(0);
  });
});
