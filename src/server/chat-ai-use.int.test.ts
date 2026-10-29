import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");
const fx = await import("./invoice-test-fixture");
const { chatWidgetFor } = await import("./chat-agent");

/**
 * The chat's notice says what an AI does with the customer's messages besides answering (wave 11 unit L, D391, docs/dpia-ai.md R4): that
 * it reads their tone and that it summarises the conversation, each only while the desk is on, has it switched on and has a text model.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;

beforeAll(async () => {
  store = await fx.makeStore("chat-ai-use");
  await db().execute(sql`insert into commerce.chat_agents (store_id, enabled, name) values (${store.storeId}::uuid, true, 'Ingrid') on conflict do nothing`);
}, 60_000);

afterAll(async () => {
  await closeDb();
});

const settings = (mode: string, tone: boolean, summaries: boolean) =>
  db().execute(sql`
    insert into commerce.support_settings (store_id, mode, tone_on, summaries_on, partner) values (${store.storeId}::uuid, ${mode}, ${tone}, ${summaries}, false)
    on conflict (store_id) do update set mode = excluded.mode, tone_on = excluded.tone_on, summaries_on = excluded.summaries_on`);

describe("what the chat's notice says an AI does with the customer's messages (D391)", () => {
  it("names each that is switched on while the desk is on and there is a text model", async () => {
    await db().execute(sql`
      insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, enabled, text_model)
      values (${store.storeId}::uuid, 'openai', ${encryptSecret("sk-test", parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!)}, 'test', true, 'text-a')`);
    await settings("ai_first", true, false);
    expect((await chatWidgetFor(store.storeId))?.aiUse).toEqual({ tone: true, summaries: false });
    await settings("people", false, true);
    expect((await chatWidgetFor(store.storeId))?.aiUse).toEqual({ tone: false, summaries: true });
    // With support off the chat agent answers alone: nothing is scored or summarised.
    await settings("off", true, true);
    expect((await chatWidgetFor(store.storeId))?.aiUse).toEqual({ tone: false, summaries: false });
  });
});
