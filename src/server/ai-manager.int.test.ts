import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { MANAGER_TOOLS, PLATFORM_TOOLS } from "@/lib/manager-tools";
import { toolDefinition } from "@/lib/owner-tools";

import type { AiConnection } from "./ai";
import type { Account, Membership } from "./auth";
import type { AssistantEvent, Principal } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => false }));

const assistant = await import("./owner-assistant");
const memory = await import("./assistant-memory");
const stores = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let member: Membership;
let admin: Account;

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
    insert into commerce.access_requests (email, name, store_name) values (${`manager-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`manager-${run}`}, 'Kaffe', null)`);
  const store = (await stores.getStore(`manager-${run}`))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`manager-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" };
  const [platform] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`platform-${run}@example.com`}, 'Ola', true) returning id, email
  `);
  admin = { id: String(platform.id), email: String(platform.email), name: "Ola", platformAdmin: true };
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await closeDb();
});

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
const says = (text: string) => sse(text.match(/[\s\S]{1,7}/g)!.map((piece) => ({ choices: [{ delta: { content: piece } }] })));
const calls = (...tools: { name: string; args: unknown }[]) =>
  sse(tools.map((tool, index) => ({ choices: [{ delta: { tool_calls: [{ index, id: `call-${index}`, function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } }] })));
/** A plain (not streamed) answer, as learning asks for. */
const completes = (text: string) => Response.json({ choices: [{ message: { role: "assistant", content: text } }] });

type Request = { messages: { role: string; content: string | null }[]; tools?: { function: { name: string } }[] };

function fakeModel(...answers: Response[]) {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return answers.shift() ?? says("(no more answers)");
    }),
  );
  return requests;
}

async function turn(p: Principal, message: string, options: { path?: string; conversationId?: string | null } = {}) {
  const events: AssistantEvent[] = [];
  const later: (() => Promise<unknown>)[] = [];
  await assistant.runTurn({
    member: p,
    conversationId: options.conversationId ?? null,
    message,
    path: options.path,
    emit: (e) => events.push(e),
    invalidate: () => {},
    later: (task) => later.push(task),
    connection,
  });
  return { events, later };
}

const toolNames = (request: Request) => (request.tools ?? []).map((t) => t.function.name);

describe("the AI manager (D103)", () => {
  it("offers its own tools as JSON Schema without refs", () => {
    for (const tool of [...MANAGER_TOOLS, ...PLATFORM_TOOLS]) {
      expect(JSON.stringify(toolDefinition(tool).parameters)).not.toContain("$ref");
    }
  });

  it("knows the admin and where the owner is, and opens pages for them", async () => {
    const requests = fakeModel(calls({ name: "open_admin_page", args: { page: "discount.new", params: {} } }), says("Here you make a new code."));
    const { events } = await turn(member, "Where do I make a coupon?", { path: `/admin/${member.store!.slug}/orders` });

    const prompt = String(requests[0].messages[0].content);
    expect(prompt).toContain("AI manager of Kaffe");
    expect(prompt).toContain("[discounts]");
    expect(prompt).toContain("They are on Orders [orders]");
    expect(prompt).toContain("run-a-sale:");
    expect(toolNames(requests[0])).toEqual(expect.arrayContaining(["list_orders", "find_admin_page", "open_admin_page", "remember"]));
    expect(toolNames(requests[0])).not.toContain("list_access_requests");
    // Subscription boxes are off: their page is not on the map.
    expect(prompt).not.toContain("[deliveries]");

    expect(events).toContainEqual({ type: "navigate", href: `/admin/${member.store!.slug}/discounts/new`, label: expect.any(String) });
    expect(events.at(-1)).toMatchObject({ type: "done", message: { content: "Here you make a new code." } });
  });

  it("does not tell the AI about a page of another store", () => {
    expect(assistant.whereText(member, "/admin/someone-else/orders")).toBeNull();
    expect(assistant.whereText(member, "/admin/platform/stores")).toBeNull();
    expect(assistant.whereText(member, `/admin/${member.store!.slug}/orders/123`)).toContain("orderId 123");
  });

  it("refuses pages that are not there or need an id it lacks", async () => {
    const requests = fakeModel(
      calls({ name: "open_admin_page", args: { page: "order", params: {} } }, { name: "open_admin_page", args: { page: "no-such-page", params: {} } }),
      says("I need the order number."),
    );
    const { events } = await turn(member, "Open the order");
    expect(events.some((e) => e.type === "navigate")).toBe(false);
    const results = requests[1].messages.filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(results[0]).toContain("needs orderId");
    expect(results[1]).toContain('There is no page \\"no-such-page\\"');
  });

  it("remembers what it is told and uses it in later conversations", async () => {
    fakeModel(calls({ name: "remember", args: { content: "Ships orders on Tuesdays and Fridays", kind: "procedure", everywhere: false } }), says("Noted."));
    await turn(member, "Remember that I ship on Tuesdays and Fridays");
    const kept = await memory.listMemories(member.account.id);
    expect(kept).toEqual([expect.objectContaining({ content: "Ships orders on Tuesdays and Fridays", source: "told", storeId: member.store!.id })]);

    const requests = fakeModel(says("On Tuesday."));
    await turn(member, "When do I ship orders?");
    expect(String(requests[0].messages[0].content)).toContain(`[${kept[0].id}] procedure: Ships orders on Tuesdays and Fridays`);

    // Saying it again updates rather than copies.
    fakeModel(calls({ name: "remember", args: { content: "Ships orders on Tuesdays and Fridays.", kind: "procedure", everywhere: false } }), says("Noted."));
    await turn(member, "Remember: shipping days are Tuesday and Friday");
    expect(await memory.listMemories(member.account.id)).toHaveLength(1);

    // Secrets are never kept.
    const refused = fakeModel(calls({ name: "remember", args: { content: "My password is hunter2", kind: "fact", everywhere: true } }), says("I can't keep that."));
    await turn(member, "Remember my password is hunter2");
    expect(String(refused[1].messages.at(-1)!.content)).toContain("not kept");

    fakeModel(calls({ name: "forget", args: { memory: kept[0].id } }), says("Forgotten."));
    await turn(member, "Forget when I ship");
    expect(await memory.listMemories(member.account.id)).toEqual([]);
  });

  it("learns what is lasting after a turn, unless the owner turned learning off", async () => {
    fakeModel(
      says("Sure, short answers from now on."),
      completes('{"memories":[{"kind":"preference","content":"Prefers short answers","everywhere":true,"importance":8},{"kind":"fact","content":"Email kari@example.com","everywhere":true}]}'),
    );
    const { later } = await turn(member, "Please keep your answers short, I read them on my phone");
    expect(later).toHaveLength(1);
    await later[0]();
    const learned = await memory.listMemories(member.account.id);
    // Emails are never kept, even when the model notes them.
    expect(learned).toEqual([expect.objectContaining({ content: "Prefers short answers", source: "learned", storeId: null, importance: 8 })]);

    await memory.setLearning(member.account.id, false);
    const requests = fakeModel(says("OK."), completes('{"memories":[{"kind":"fact","content":"Sells coffee beans","everywhere":false}]}'));
    const { later: next } = await turn(member, "I sell coffee beans");
    await next[0]();
    expect(requests).toHaveLength(1);
    expect(await memory.listMemories(member.account.id)).toHaveLength(1);
    await memory.setLearning(member.account.id, true);
    await memory.deleteAllMemories(member.account.id);
  });

  it("keeps thumbs on answers, and learns from them", async () => {
    fakeModel(says("Sales were up."));
    const { events } = await turn(member, "How are sales?");
    const done = events.find((e) => e.type === "done")!;
    const id = done.type === "done" ? done.message.id : "";
    const later: (() => Promise<unknown>)[] = [];
    const other = { ...member, account: { ...member.account, id: admin.id } };
    expect(await assistant.rateAnswer(other, id, -1, null)).toBe(false);

    vi.stubGlobal("fetch", vi.fn());
    const requests = fakeModel(completes('{"memories":[{"kind":"preference","content":"Wants numbers with sales answers","everywhere":true}]}'));
    // The thumb learns with the site's own AI; here none is set up, so nothing is asked.
    expect(await assistant.rateAnswer(member, id, -1, null, (task) => later.push(task))).toBe(true);
    await later[0]();
    expect(requests).toHaveLength(0);
    const conversation = await assistant.getConversation(member, (events[0] as { id: string }).id);
    expect(conversation!.messages.at(-1)).toMatchObject({ id, feedback: -1 });
    expect(await assistant.rateAnswer(member, id, null, null)).toBe(true);
  });

  it("works for platform admins with Kaizen's own tools, apart from stores' conversations", async () => {
    const platform: Principal = { account: admin, store: null };
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name, message) values (${`asks-${run}@example.com`}, 'Per', 'Pers te', 'Tea') returning id
    `);
    const requests = fakeModel(
      calls({ name: "list_access_requests", args: { status: "pending" } }),
      calls({ name: "approve_access_request", args: { request: String(request.id), slug: `te-${run}` } }),
      says("Per is waiting: approve with the button."),
    );
    const { events } = await turn(platform, "Who is waiting?", { path: "/admin/platform/stores" });
    const prompt = String(requests[0].messages[0].content);
    expect(prompt).toContain("Kaizen's AI manager");
    expect(prompt).toContain("They are on Stores [stores]");
    expect(prompt).toContain("review-requests:");
    expect(toolNames(requests[0])).toEqual(expect.arrayContaining(["platform_overview", "list_access_requests", "open_admin_page"]));
    expect(toolNames(requests[0])).not.toContain("list_orders");
    expect(String(requests[1].messages.at(-1)!.content)).toContain(`asks-${run}@example.com`);

    const approval = events.find((e) => e.type === "approval");
    expect(approval).toMatchObject({ approval: { tool: "approve_access_request", status: "pending" } });
    const conversationId = (events[0] as { id: string }).id;
    const [row] = await db().execute<Row>(sql`select store_id from commerce.assistant_conversations where id = ${conversationId}::uuid`);
    expect(row.store_id).toBeNull();
    expect(await assistant.listConversations(member)).not.toContainEqual(expect.objectContaining({ id: conversationId }));
    expect(await assistant.getConversation(member, conversationId)).toBeNull();

    // Only the platform admin decides, and yes creates the store.
    const approvalId = approval!.type === "approval" ? approval!.approval.id : "";
    expect(await assistant.decideApproval(member, approvalId, true, () => {})).toBeNull();
    expect(await assistant.decideApproval(platform, approvalId, true, () => {})).toMatchObject({ status: "done" });
    expect(await stores.getStore(`te-${run}`)).toMatchObject({ name: "Pers te" });
  });

  it("refuses platform tools to anyone who is not a platform admin", async () => {
    const requests = fakeModel(calls({ name: "platform_overview", args: {} }), says("I can't."));
    await turn({ account: member.account, store: null }, "How is Kaizen doing?");
    expect(String(requests[1].messages.at(-1)!.content)).toContain("Only platform admins");
  });

  it("finds memories by keyword and lets unused learned ones fade", async () => {
    const accountId = member.account.id;
    await memory.keepMemory({ accountId, storeId: null, kind: "fact", content: "Imports beans from Ethiopia", source: "learned" });
    await memory.keepMemory({ accountId, storeId: member.store!.id, kind: "goal", content: "Wants to open a café next spring", source: "told" });
    const found = await memory.memoriesFor(accountId, member.store!.id, "Where do the beans come from?", null, 1);
    expect(found.map((m) => m.content)).toEqual(["Imports beans from Ethiopia"]);
    // Memories about another store are not given.
    expect((await memory.memoriesFor(accountId, null, "café", null)).map((m) => m.content)).not.toContain("Wants to open a café next spring");

    await db().execute(sql`update commerce.assistant_memories set last_used_at = now() - interval '200 days', updated_at = now() - interval '200 days', importance = 2 where account_id = ${accountId}::uuid`);
    await memory.fadeMemories();
    // What the owner told it stays; learned ones nobody used go.
    expect((await memory.listMemories(accountId)).map((m) => m.content)).toEqual(["Wants to open a café next spring"]);
    await memory.deleteAllMemories(accountId);
  });
});
