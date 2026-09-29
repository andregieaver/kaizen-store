import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { OWNER_TOOLS, toolDefinition } from "@/lib/owner-tools";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { Approval, AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const assistant = await import("./owner-assistant");
const ownerTools = await import("./owner-tools");
const stores = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let member: Membership;
let productId: string;
let productHandle: string;

const connection = {
  provider: "openai",
  apiUrl: "https://ai.example/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  textEuOnly: false,
  zeroDataRetention: false,
} as unknown as AiConnection;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`owner-ai-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`owner-ai-${run}`}, 'Kaffe', null)`);
  const store = (await stores.getStore(`owner-ai-${run}`))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`owner-ai-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" };
  const [product] = await db().execute<Row>(sql`
    select id, handle from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 1
  `);
  productId = String(product.id);
  productHandle = String(product.handle);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await closeDb();
});

/** A provider answering in the stream format: text in pieces, or tool calls whose arguments come in pieces. */
function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
const says = (text: string) => sse(text.match(/[\s\S]{1,7}/g)!.map((piece) => ({ choices: [{ delta: { content: piece } }] })));
const calls = (...tools: { name: string; args: unknown }[]) =>
  sse(
    tools.flatMap((tool, index) => {
      const args = JSON.stringify(tool.args);
      return [
        { choices: [{ delta: { tool_calls: [{ index, id: `call-${index}`, function: { name: tool.name, arguments: "" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(0, 5) } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(5) } }] } }] },
      ];
    }),
  );

/** The model's answers in turn; what each request held is kept. */
function fakeModel(...answers: Response[]) {
  const requests: { messages: { role: string; content: string | null }[]; tools?: unknown[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return answers.shift() ?? says("(no more answers)");
    }),
  );
  return requests;
}

async function turn(message: string, conversationId: string | null = null) {
  const events: AssistantEvent[] = [];
  await assistant.runTurn({ member, conversationId, message, emit: (e) => events.push(e), invalidate: () => {}, connection });
  return events;
}

describe("the owner assistant (D94)", () => {
  it("offers its tools as JSON Schema without refs", () => {
    for (const tool of OWNER_TOOLS) {
      const definition = toolDefinition(tool);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
  });

  it("runs every tool that reads against the store's own data", async () => {
    const ctx = { account: member.account, store: member.store, invalidate: () => {} };
    const args: Record<string, unknown> = {
      get_product: { product: productHandle },
      get_order: { order: "1" },
      get_customer: { customer: "nobody@example.com" },
    };
    for (const tool of OWNER_TOOLS.filter((t) => !("gate" in t) && t.name !== "add_order_note")) {
      const result = ownerTools.runOwnerTool(ctx, tool.name, args[tool.name] ?? {});
      if (tool.name === "get_order") await expect(result).rejects.toThrow("No order 1 in this store.");
      else if (tool.name === "get_customer") await expect(result).rejects.toThrow(ownerTools.OwnerToolError);
      else await expect(result, tool.name).resolves.toBeTruthy();
    }
    expect(await ownerTools.runOwnerTool(ctx, "get_product", { product: productHandle })).toMatchObject({
      handle: productHandle,
      variants: expect.arrayContaining([expect.objectContaining({ prices: expect.arrayContaining([expect.objectContaining({ country: "NO" })]) })]),
    });
    await expect(ownerTools.runOwnerTool(ctx, "list_orders", { limit: 500 })).rejects.toThrow("The arguments could not be read");
  });

  let conversationId: string;

  it("answers from the store's own data, streaming, and keeps the conversation", async () => {
    const requests = fakeModel(
      calls({ name: "store_overview", args: {} }, { name: "sales_summary", args: { days: 7 } }),
      says("Kaffe er åpen og har ingen salg denne uken."),
    );
    const events = await turn("Hvordan går det med butikken?");
    const started = events.find((e) => e.type === "conversation");
    expect(started).toMatchObject({ title: "Hvordan går det med butikken?" });
    conversationId = (started as { id: string }).id;
    expect(events.filter((e) => e.type === "round")).toEqual([{ type: "round", tools: ["store_overview", "sales_summary"] }]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      message: { role: "assistant", content: "Kaffe er åpen og har ingen salg denne uken.", tools: [{ name: "store_overview", ok: true }, { name: "sales_summary", ok: true }] },
    });
    // The tools answered from the store: its name, and no sales.
    const toolAnswers = requests[1].messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
    expect(toolAnswers[0]).toContain('"name":"Kaffe"');
    expect(toolAnswers[1]).toContain("No paid orders in this period.");
    expect(requests[0].messages[0].content).toContain("Never add up");
    const saved = (await assistant.getConversation(member, conversationId))!;
    expect(saved.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("gives the model a tool's refusal, and remembers the conversation", async () => {
    const requests = fakeModel(calls({ name: "get_order", args: { order: "99999" } }), says("Fant ingen ordre 99999."));
    await turn("Vis ordre 99999", conversationId);
    expect(requests[0].messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("No order 99999 in this store.") });
  });

  it("keeps a change for the owner's yes, and runs exactly that call once approved", async () => {
    fakeModel(calls({ name: "archive_product", args: { product: productHandle } }), says("Venter på at du godkjenner."));
    const events = await turn(`Ta ${productHandle} av nettsiden`, conversationId);
    const queued = events.find((e) => e.type === "approval") as { approval: Approval };
    expect(queued.approval).toMatchObject({ tool: "archive_product", category: "public", status: "pending", summary: `Take the product "${productHandle}" off the site.` });
    // Not done by the model alone.
    const [before] = await db().execute<Row>(sql`select status from commerce.products where id = ${productId}::uuid`);
    expect(before.status).toBe("active");

    const invalidated: string[] = [];
    const decided = await assistant.decideApproval(member, queued.approval.id, true, (tag) => invalidated.push(tag));
    expect(decided).toMatchObject({ status: "done", outcome: `${productHandle} is taken off the site.` });
    const [after] = await db().execute<Row>(sql`select status from commerce.products where id = ${productId}::uuid`);
    expect(after.status).toBe("archived");
    expect(invalidated).toEqual([`catalog:${member.store.id}`]);
    // Once.
    expect(await assistant.decideApproval(member, queued.approval.id, true, () => {})).toBeNull();
    const [logged] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where store_id = ${member.store.id}::uuid and action = 'store.assistant.archive_product'
    `);
    expect(logged.n).toBe(1);
  });

  it("declines, and says so in the conversation", async () => {
    fakeModel(calls({ name: "archive_product", args: { product: productHandle, archived: false } }), says("Venter."));
    const events = await turn("Legg den tilbake", conversationId);
    const queued = events.find((e) => e.type === "approval") as { approval: Approval };
    expect(await assistant.decideApproval(member, queued.approval.id, false, () => {})).toMatchObject({ status: "declined" });
    const saved = (await assistant.getConversation(member, conversationId))!;
    expect(saved.messages.at(-1)).toMatchObject({ role: "assistant", content: expect.stringContaining("Declined:") });
    const [still] = await db().execute<Row>(sql`select status from commerce.products where id = ${productId}::uuid`);
    expect(still.status).toBe("archived");
  });

  it("is each owner's own, and says so when there is no text model", async () => {
    const other = { ...member, account: { ...member.account, id: "00000000-0000-4000-8000-000000000000" } };
    expect(await assistant.getConversation(other, conversationId)).toBeNull();
    expect(await assistant.decideApproval(other, conversationId, true, () => {})).toBeNull();
    const events: AssistantEvent[] = [];
    await assistant.runTurn({ member, conversationId: null, message: "Hei", emit: (e) => events.push(e), invalidate: () => {}, connection: null });
    expect(events).toEqual([{ type: "error", message: expect.stringContaining("Settings → AI") }]);
    expect(await assistant.deleteConversation(member, conversationId)).toBe(true);
    expect(await assistant.listConversations(member)).toEqual([]);
  });
});
