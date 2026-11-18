import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => false }));

const assistant = await import("./owner-assistant");
const stores = await import("./stores");

type Row = Record<string, unknown>;

/**
 * The AI manager's turns in the usage table (bloat review step 1.19): every round of a turn is one row of `commerce.ai_usage` with the
 * turn's id, its round and the input tokens the provider read from its cache, also the rounds metered as `analytics_question` after a
 * report. The model is a stand-in for the provider's streamed answers, as `ai-manager.int.test.ts` stubs them, with usage in each.
 */

const run = Date.now().toString(36);
let member: Membership;
let connection: AiConnection;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`turns-${run}@example.com`}, 'Kari', 'Turns') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`turns-${run}`}, 'Turns', null)`);
  const store = (await stores.getStore(`turns-${run}`))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`turns-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" } as Membership;
  connection = {
    provider: "openai",
    apiUrl: "https://ai.example/v1",
    apiKey: "sk-test",
    source: "store",
    textModel: "text-model",
    textEuOnly: false,
    zeroDataRetention: false,
    usage: { storeId: store.id, feature: "ai_manager", accountId: String(account.id) },
  } as unknown as AiConnection;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

/** A streamed answer: its pieces, then the usage chunk the provider sends last when asked (`stream_options.include_usage`). */
function sse(chunks: unknown[], usage: unknown): Response {
  const body = [...chunks, { choices: [], usage }].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
const calls = (name: string, args: unknown, usage: unknown) =>
  sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } }] } }] }], usage);
const says = (text: string, usage: unknown) => sse([{ choices: [{ delta: { content: text } }] }], usage);
const usage = (cached: number) => ({ prompt_tokens: 1000, completion_tokens: 50, ...(cached ? { prompt_tokens_details: { cached_tokens: cached } } : {}) });

/** Answers the model's rounds in order; anything else asked of the provider (a memory's vector) answers empty. */
function fakeModel(...answers: Response[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (String(url).endsWith("/chat/completions") ? (answers.shift() ?? says("(no more answers)", usage(0))) : Response.json({}))),
  );
}

async function turn(message: string) {
  const events: AssistantEvent[] = [];
  await assistant.runTurn({ member, conversationId: null, message, emit: (e) => events.push(e), invalidate: () => {}, connection });
  return events;
}

describe("the AI manager's rounds in the usage table (bloat review step 1.19)", () => {
  it("keeps a turn of three rounds as one turn: its id, rounds 0, 1 and 2, and the cached input tokens", async () => {
    fakeModel(
      calls("run_report", { metrics: ["net_sales"], dimensions: ["product"], period: { preset: "last_month" } }, usage(0)),
      calls("list_orders", {}, usage(800)),
      says("Last month's sales and the latest orders are above.", usage(800)),
    );
    const events = await turn("What did we sell last month, and what are the latest orders?");
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const rows = await db().execute<Row>(sql`
      select turn_id, round, cached_input_tokens, input_tokens, feature from commerce.ai_usage
      where store_id = ${member.store.id}::uuid and feature in ('ai_manager', 'analytics_question') and kind = 'text' and not estimated
      order by round
    `);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => String(r.turn_id))).size).toBe(1);
    expect(rows[0].turn_id).not.toBeNull();
    expect(rows.map((r) => Number(r.round))).toEqual([0, 1, 2]);
    expect(rows.map((r) => Number(r.cached_input_tokens))).toEqual([0, 800, 800]);
    expect(rows.map((r) => Number(r.input_tokens))).toEqual([1000, 1000, 1000]);
    // The rounds after the report are the figures' question's (D346), and they carry the turn too.
    expect(rows.map((r) => String(r.feature))).toEqual(["ai_manager", "analytics_question", "analytics_question"]);
  });
});
