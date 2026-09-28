import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.KAIZEN_LIFE_ISSUER = "https://life.example/auth/v1";
process.env.KAIZEN_LIFE_URL = "https://life-app.example";
process.env.KAIZEN_LIFE_OAUTH_CLIENT_ID = "store-at-life";
process.env.KAIZEN_LIFE_OAUTH_CLIENT_SECRET = "store-secret";

const link = await import("./kaizen-life-link");
const assistant = await import("./owner-assistant");
const stores = await import("./stores");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let member: Membership;

const connection = {
  provider: "openai",
  apiUrl: "https://ai.example/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  textEuOnly: false,
  zeroDataRetention: false,
} as unknown as AiConnection;

/** A token as Kaizen Life's server issues it: only its payload is read here, for the email. */
const lifeToken = (email: string) =>
  ["e30", Buffer.from(JSON.stringify({ email, sub: "life-user" })).toString("base64url"), "sig"].join(".");

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`life-link-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`life-link-${run}`}, 'Kaffe', null)`);
  const store = (await stores.getStore(`life-link-${run}`))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`life-link-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" };
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await closeDb();
});

type Sent = { url: string; headers: Record<string, string>; body: string };

/** Answers requests in turn, keeping what was sent. */
function fakeFetch(...answers: Response[]) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
      return answers.shift() ?? new Response("{}", { status: 500 });
    }),
  );
  return sent;
}

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

describe("Kaizen Life for the owner assistant (D96)", () => {
  it("connects with PKCE and a state bound to the account, and keeps the tokens encrypted", async () => {
    const start = link.linkStart(member.account.id)!;
    const url = new URL(start.url);
    expect(url.origin + url.pathname).toBe("https://life.example/auth/v1/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("store-at-life");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state")!;

    // Someone else's callback, or another state, is refused before any exchange.
    const none = fakeFetch();
    await expect(link.linkFinish(crypto.randomUUID(), start.cookie, new URLSearchParams({ state, code: "c" }))).rejects.toThrow(link.LifeLinkError);
    await expect(link.linkFinish(member.account.id, start.cookie, new URLSearchParams({ state: "other", code: "c" }))).rejects.toThrow(link.LifeLinkError);
    expect(none).toHaveLength(0);

    const sent = fakeFetch(Response.json({ access_token: lifeToken("kari@life.example"), refresh_token: "refresh-1", expires_in: 3600 }));
    await link.linkFinish(member.account.id, start.cookie, new URLSearchParams({ state, code: "the-code" }));
    expect(sent[0].url).toBe("https://life.example/auth/v1/oauth/token");
    expect(sent[0].headers.Authorization).toBe(`Basic ${Buffer.from("store-at-life:store-secret").toString("base64")}`);
    const body = new URLSearchParams(sent[0].body);
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe(start.cookie.split(".")[1]);

    expect(await link.lifeLink(member.account.id)).toMatchObject({ email: "kari@life.example" });
    const [row] = await db().execute<Row>(sql`select access_token, refresh_token from commerce.kaizen_life_links where account_id = ${member.account.id}::uuid`);
    expect(String(row.access_token)).not.toContain(".sig");
    expect(String(row.refresh_token)).not.toBe("refresh-1");
  });

  it("asks Kaizen Life's assistant through its MCP server, refreshing a token about to run out", async () => {
    await db().execute(sql`update commerce.kaizen_life_links set expires_at = now() where account_id = ${member.account.id}::uuid`);
    const sent = fakeFetch(
      Response.json({ access_token: lifeToken("kari@life.example"), expires_in: 3600 }),
      Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Du er ledig torsdag etter kl. 14." }] } }),
    );
    expect(await link.askLife(member.account.id, "Når er jeg ledig?", "Kaffe")).toBe("Du er ledig torsdag etter kl. 14.");
    expect(new URLSearchParams(sent[0].body).get("refresh_token")).toBe("refresh-1");
    expect(sent[1].url).toBe("https://life-app.example/api/mcp");
    expect(JSON.parse(sent[1].body)).toMatchObject({
      method: "tools/call",
      params: { name: "ask_life_assistant", arguments: { question: "Når er jeg ledig?", from: "Kaffe" } },
    });
    // The refresh token is kept when a refresh brings no new one.
    const again = fakeFetch(Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Nei." }], isError: true } }));
    await expect(link.askLife(member.account.id, "Noe?", "Kaffe")).rejects.toThrow("Kaizen Life said: Nei.");
    expect(again).toHaveLength(1);
  });

  it("is offered to the store's assistant only when connected and not asked by Kaizen Life", async () => {
    const turn = async (fromKaizenLife: boolean) => {
      const requests: { tools?: { function: { name: string } }[]; messages: { role: string; content: string | null }[] }[] = [];
      const answers = [
        sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c0", function: { name: "ask_kaizen_life", arguments: '{"question":"Når er jeg ledig?"}' } }] } }] }]),
        sse([{ choices: [{ delta: { content: "Torsdag." } }] }]),
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          if (String(url).startsWith("https://ai.example")) {
            requests.push(JSON.parse(String(init.body)));
            return answers.shift()!;
          }
          return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Torsdag etter kl. 14." }] } });
        }),
      );
      const events: AssistantEvent[] = [];
      await assistant.runTurn({ member, conversationId: null, message: "Når er jeg ledig?", emit: (e) => events.push(e), invalidate: () => {}, connection, fromKaizenLife });
      return { requests, events };
    };

    const own = await turn(false);
    expect(own.requests[0].tools?.map((t) => t.function.name)).toContain("ask_kaizen_life");
    expect(own.requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("Torsdag etter kl. 14.") });
    expect(own.events.at(-1)).toMatchObject({ type: "done", message: { content: "Torsdag.", tools: [{ name: "ask_kaizen_life", ok: true }] } });

    const asked = await turn(true);
    expect(asked.requests[0].tools?.map((t) => t.function.name)).not.toContain("ask_kaizen_life");
    expect(asked.requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("There is no tool called ask_kaizen_life") });

    expect(await link.unlinkLife(member.account.id)).toBe(true);
    expect(await link.lifeLink(member.account.id)).toBeNull();
    const after = await turn(false);
    expect(after.requests[0].tools?.map((t) => t.function.name)).not.toContain("ask_kaizen_life");
  });
});
