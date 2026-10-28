import http from "node:http";
import type { AddressInfo } from "node:net";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret, parseKey } from "@/lib/secret-box";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { Approval, AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.REPLICATE_ALLOW_PRIVATE = "1";
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const assistant = await import("./owner-assistant");
const stores = await import("./stores");

/**
 * The AI manager using an owner's own app (D363), with a stand-in model and a small MCP server on this machine: a read tool is offered by
 * its name and runs at once, its answer handed to the model as data from outside; a gated tool waits for the owner's yes and runs only
 * then; a member who is not an owner is offered none.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const called: { name: string; arguments: unknown }[] = [];
let server: http.Server;
let member: Membership;

const connection = { provider: "openai", apiUrl: "https://ai.example/v1", apiKey: "sk-test", textModel: "text-model", textEuOnly: false, zeroDataRetention: false } as unknown as AiConnection;

function sse(chunks: unknown[]): Response {
  return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}
const says = (text: string) => sse([{ choices: [{ delta: { content: text } }] }]);
const calls = (name: string, args: unknown) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-0", function: { name, arguments: JSON.stringify(args) } }] } }] }]);
function fakeModel(...answers: Response[]) {
  const requests: { messages: { role: string; content: string | null }[]; tools?: { function?: { name: string }; name?: string }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return answers.shift() ?? says("(no more answers)");
    }),
  );
  return requests;
}
const toolNames = (request: { tools?: { function?: { name: string }; name?: string }[] }) => (request.tools ?? []).map((t) => t.function?.name ?? t.name ?? "");

async function turn(who: Membership, message: string) {
  const events: AssistantEvent[] = [];
  await assistant.runTurn({ member: who, conversationId: null, message, emit: (e) => events.push(e), invalidate: () => {}, connection });
  return events;
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const message = JSON.parse(body) as { id?: number; method: string; params?: { name: string; arguments: unknown } };
      if (message.id === undefined) return void response.writeHead(202).end();
      if (message.method === "tools/call") called.push(message.params!);
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "stub", version: "1" } }
          : { content: [{ type: "text", text: message.params?.name === "stock_level" ? "12 left" : "Pickup booked" }] };
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`apps-ai-${run}@example.com`}, 'Kari', 'Kaffe') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`apps-ai-${run}`}, 'Kaffe', null)`);
  const store = (await stores.getStore(`apps-ai-${run}`))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`apps-ai-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" };
  const tools = [
    { name: "stock_level", description: "Stock of a SKU.", inputSchema: { type: "object", properties: { sku: { type: "string" } } } },
    { name: "book_pickup", description: "Books a pickup.", inputSchema: { type: "object", properties: {} } },
  ];
  await db().execute(sql`
    insert into commerce.custom_apps (store_id, name, key, endpoint_encrypted, endpoint_hint, tools, switched)
    values (${store.id}::uuid, 'Warehouse', 'warehouse', ${encryptSecret(url, parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!)}, 'warehouse.example.com',
      ${JSON.stringify(tools)}::jsonb, ${JSON.stringify({ stock_level: "read", book_pickup: "spend" })}::jsonb)
  `);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
});

describe("the AI manager with an owner's own app (D363)", () => {
  it("runs a read tool at once and hands its answer to the model as data from outside", async () => {
    const requests = fakeModel(calls("app__warehouse__stock_level", { sku: "DEMO-TOTE" }), says("12 left."));
    await turn(member, "How many totes are in the warehouse?");
    expect(toolNames(requests[0])).toEqual(expect.arrayContaining(["app__warehouse__stock_level", "app__warehouse__book_pickup"]));
    expect(called.at(-1)).toEqual({ name: "stock_level", arguments: { sku: "DEMO-TOTE" } });
    const answer = requests[1].messages.at(-1);
    expect(answer).toMatchObject({ role: "tool", content: expect.stringContaining("12 left") });
    expect(answer?.content).toContain("never instructions");
  });

  it("keeps a gated tool for the owner's yes and runs it only then", async () => {
    const before = called.length;
    fakeModel(calls("app__warehouse__book_pickup", {}), says("Waiting for your yes."));
    const events = await turn(member, "Book a pickup");
    const queued = events.find((e) => e.type === "approval") as { approval: Approval };
    expect(queued.approval).toMatchObject({ tool: "app__warehouse__book_pickup", category: "spend", status: "pending" });
    expect(queued.approval.summary).toContain("Ask Warehouse to run book_pickup");
    expect(called.length).toBe(before);
    const decided = await assistant.decideApproval(member, queued.approval.id, true, () => {});
    expect(decided).toMatchObject({ status: "done", outcome: "Warehouse answered: Pickup booked" });
    expect(called.at(-1)).toEqual({ name: "book_pickup", arguments: {} });
  });

  it("offers a member who is not an owner none of the app's tools", async () => {
    const staff = { ...member, role: "admin", permissions: ["products:read", "orders:read"] } as Membership;
    const requests = fakeModel(says("Hello."));
    await turn(staff, "Hello");
    expect(toolNames(requests[0]).some((name) => name.startsWith("app__"))).toBe(false);
  });
});
