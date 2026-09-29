import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";

import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const live = await import("./live-voice");
const assistant = await import("./owner-assistant");
const stores = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let member: Membership;

function form(values: Record<string, string | boolean>): ReturnType<typeof aiFormValues> {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (value === true) data.set(name, "on");
    else if (value !== false) data.set(name, value);
  }
  return aiFormValues(data);
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`live-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`live-${run}`}, 'Kaffe', null)`);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`live-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store: (await stores.getStore(`live-${run}`))!, role: "owner" };
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await db().execute(sql`delete from commerce.ai_providers where store_id = ${member.store!.id}::uuid`);
  await closeDb();
});

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
const says = (text: string) => sse([{ choices: [{ delta: { content: text } }] }]);
const calls = (name: string, args: unknown) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-0", function: { name, arguments: JSON.stringify(args) } }] } }] }]);

describe("the AI manager's live voice (D105)", () => {
  it("keeps the live model and voice as settings, from the same provider or another with its own key", async () => {
    const saved = await ai.saveAiSettings(
      member.account.id,
      member.store!.id,
      form({ provider: "mistral", apiKey: "mistral-key-1234", textModel: "text-model", liveModel: "live-model-1", liveVoice: "warm", liveProvider: "openai", liveApiKey: "sk-live-5678", enabled: true }),
    );
    expect(saved).toEqual({ ok: true });
    const connection = (await ai.aiFor(member.store!.id))!;
    expect(connection.live).toEqual({ provider: "openai", apiUrl: "https://api.openai.com/v1", apiKey: "sk-live-5678", model: "live-model-1", voice: "warm" });
    expect(await ai.getAiSettings(member.store!.id)).toMatchObject({ liveApiKeyHint: "…5678", liveProvider: "openai" });
    expect((await assistant.assistantAbilities(member.store!.id)).live).toBe(true);

    // Another provider needs its key; a kept one stays when saved again.
    expect(await ai.saveAiSettings(member.account.id, member.store!.id, form({ provider: "mistral", textModel: "text-model", liveModel: "live-model-2", liveProvider: "openai_eu", enabled: true }))).toMatchObject({
      ok: false,
    });
    expect(await ai.saveAiSettings(member.account.id, member.store!.id, form({ provider: "mistral", textModel: "text-model", liveModel: "live-model-2", liveProvider: "openai", enabled: true }))).toEqual({ ok: true });
    expect((await ai.aiFor(member.store!.id))!.live).toMatchObject({ apiKey: "sk-live-5678", model: "live-model-2", voice: null });
  });

  it("starts a call with the session made on the server: its model, instructions, history and what the page may send", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        return Response.json({ session: { id: "sess_1" }, transport: { sdp: "v=0 answer" } });
      }),
    );
    const call = await live.startLiveSession(member, { sdp: "v=0 offer", conversationId: null });
    expect(call).toMatchObject({ sdp: "v=0 answer", sessionId: "sess_1", conversationId: expect.any(String), opening: expect.stringContaining("Greet them") });
    expect(requests[0].url).toBe("https://api.openai.com/v1/live/sessions");
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-live-5678");
    const body = JSON.parse(String(requests[0].init.body));
    expect(body.transport).toEqual({ type: "webrtc", sdp: "v=0 offer" });
    expect(body.session).toMatchObject({ model: "live-model-2", delegation: { type: "client" }, store: false, input: [] });
    expect(body.session.audio).toBeUndefined();
    expect(body.session.instructions).toContain("AI manager of Kaffe");
    expect(body.session.instructions).toContain("Delegate BEFORE you answer");
    expect(body.session.client.data_channel.allowed_client_events).not.toContain("session.update");

    // A second call soon after continues the same conversation, with its history.
    await assistant.addMessage(member, call.conversationId, "user", "How are sales?");
    const again = await live.startLiveSession(member, { sdp: "v=0 offer", conversationId: null });
    expect(again.conversationId).toBe(call.conversationId);
    const second = JSON.parse(String(requests[1].init.body));
    expect(second.session.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "How are sales?" }] }]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    await expect(live.startLiveSession(member, { sdp: "v=0 offer", conversationId: null })).rejects.toThrow("out of quota");
  });

  it("does the work a call hands over as an AI manager turn, and keeps the call in its conversation", async () => {
    const call = await (async () => {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ session: { id: "s" }, transport: { sdp: "v=0" } })));
      return live.startLiveSession(member, { sdp: "v=0 offer", conversationId: null });
    })();
    const conversationId = call.conversationId;
    const requests: { messages: { role: string; content: string }[] }[] = [];
    const answers = [calls("open_admin_page", { page: "discounts", params: {} }), says("You have no coupons yet; the page is open.")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return answers.shift() ?? says("…");
      }),
    );
    const result = await live.delegateLive(
      member,
      {
        conversationId,
        turns: [
          { role: "user", text: "Hi there" },
          { role: "assistant", text: ">Hi Kari, what can I do?" },
          { role: "user", text: "Show me my coupons" },
        ],
        path: `/admin/${member.store!.slug}/orders`,
      },
      () => {},
    );
    expect(result).toEqual({
      speak: "You have no coupons yet; the page is open.",
      navigate: [{ href: `/admin/${member.store!.slug}/discounts`, label: expect.any(String) }],
      approvals: [],
    });
    // The voice turn's rules and where they are reach the AI manager.
    expect(requests[0].messages[0].content).toContain("read aloud");
    expect(requests[0].messages[0].content).toContain("They are on Orders [orders]");
    // Kept: what was said before, and the request; the answer is kept by the transcript, as the voice said it.
    const saved = await assistant.getConversation(member, conversationId);
    expect(saved!.messages.slice(-3).map((m) => [m.role, m.content])).toEqual([
      ["user", "Hi there"],
      ["assistant", "Hi Kari, what can I do?"],
      ["user", "Show me my coupons"],
    ]);

    expect(await live.saveLiveTurns(member, conversationId, [{ role: "assistant", text: "You have no coupons yet." }, { role: "user", text: "" }])).toBe(1);
    const after = await assistant.getConversation(member, conversationId);
    expect(after!.messages.at(-1)).toMatchObject({ role: "assistant", content: "You have no coupons yet." });
    // Named after the first thing said in it (this call continued the one before).
    expect(after!.title).toBe("How are sales?");

    // Only the person's own conversations.
    const other = { ...member, account: { ...member.account, id: "00000000-0000-4000-8000-000000000000" } };
    expect(await live.saveLiveTurns(other, conversationId, [{ role: "user", text: "x" }])).toBeNull();
    expect(await live.delegateLive(other, { conversationId, turns: [], path: null }, () => {})).toBeNull();
  });
});
