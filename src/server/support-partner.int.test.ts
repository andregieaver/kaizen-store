import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));
vi.mock("./stripe", async (importOriginal) => ({ ...(await importOriginal<typeof import("./stripe")>()), platformStripe: () => ({}) }));
const ai = vi.hoisted(() => ({ stores: new Set<string>() }));
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  return {
    ...real,
    aiFor: async (storeId: string | null, ...rest: unknown[]) =>
      storeId && ai.stores.has(storeId)
        ? ({ provider: "openai", source: "store", apiUrl: "https://ai.example.com/v1", apiKey: "sk-test", textModel: "text-model", embeddingModel: null, space: null } as never)
        : (real.aiFor as (...args: unknown[]) => unknown)(storeId, ...rest),
  };
});

const support = await import("./support");
const { runPartner } = await import("./support-partner");
const { systemDesk } = await import("./support-desk");
type Staff = import("./support-desk").StaffDesk;

/**
 * The silent partner (D216, step 8; docs/support.md C21–C25) with a stand-in model: it runs only when the desk, the person and the
 * conversation allow it, once per customer message whoever asks, reads only what the person's role may, keeps a draft from a
 * customer who is not signed in when it read their orders, cleans a draft's claims, and never reaches the customer.
 */

const run = Date.now().toString(36);
let storeId: string;
let owner: Staff;
let orderless: Staff;

beforeAll(async () => {
  const slug = `partner-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Partner test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${storeId}::uuid`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on) values (${storeId}::uuid, 'people', false, false)`);
  ai.stores.add(storeId);
  const [o] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  await db().execute(sql`update commerce.accounts set name = 'Kari Nordmann' where id = ${String(o.id)}::uuid`);
  const [second] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`ola-${slug}@example.com`}, 'Ola Hansen') returning id`);
  const store = { id: storeId, slug, name: "Partner test" };
  owner = { desk: systemDesk(storeId), store, account: { id: String(o.id), email: String(o.email), name: "Kari Nordmann" } as unknown as Staff["account"], canWrite: true, holder: { role: "owner" } };
  // A support agent whose role may not read orders or customers.
  orderless = { desk: systemDesk(storeId), store, account: { id: String(second.id), email: `ola-${slug}@example.com`, name: "Ola Hansen" } as unknown as Staff["account"], canWrite: true, holder: { role: "admin", permissions: ["support:read", "support:write", "products:read"] } };
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => closeDb());

/** The model's steps in turn (each a message: text, or tool calls), keeping every request. */
function model(steps: Record<string, unknown>[]) {
  const asked: { tools: string[]; messages: { role: string; content: unknown }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] };
      asked.push({ tools: (body.tools ?? []).map((t) => t.function.name), messages: body.messages });
      return Response.json({ choices: [{ message: steps.shift() ?? { content: "{}" } }] });
    }),
  );
  return asked;
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ content: null, tool_calls: [{ id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const final = (value: Record<string, unknown>) => ({ content: JSON.stringify(value) });

/** A conversation the person has, with a customer message; returns its id and that message's number. */
async function theirs(staff: Staff, words = "Where is my order?") {
  const [c] = await db().execute<Row>(sql`insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values (${storeId}::uuid, 'site', 'queue', ${`p-${Math.random()}`}, 'nb-NO') returning id`);
  const id = String(c.id);
  await support.addMessage(staff.desk, id, "customer", null, words);
  await support.transition(staff.desk, id, "claim", { kind: "agent", id: staff.account.id, name: "Kari" });
  const added = await support.addMessage(staff.desk, id, "customer", null, `${words} Please hurry.`);
  return { id, seq: added!.seq };
}

const partnerMessages = async (id: string) =>
  db().execute<Row>(sql`select kind, body, data, account_id from commerce.support_messages where conversation_id = ${id}::uuid and author = 'partner' order by seq`);

describe("the silent partner (C21–C25)", () => {
  it("runs for the person who has the conversation, and keeps facts from tools it called, a recommendation and a draft", async () => {
    const c = await theirs(owner);
    const asked = model([
      call("conversation_facts"),
      final({ facts: [{ text: "The customer is not signed in", tool: "conversation_facts" }, { text: "Invented", tool: "get_order" }], recommendation: "Ask them to sign in.", draft: "Hei! Logg inn, så ser vi på det." }),
    ]);
    expect(await runPartner(owner, c.id, { kind: "message", seq: c.seq })).toEqual({ ok: true, ran: true });
    const [kept] = await partnerMessages(c.id);
    expect(kept).toMatchObject({ kind: "suggestion", account_id: owner.account.id });
    // A fact naming a tool it did not call this turn is dropped.
    expect((kept.data as { facts: unknown[] }).facts).toEqual([{ text: "The customer is not signed in", tool: "conversation_facts" }]);
    expect(kept.data).toMatchObject({ recommendation: "Ask them to sign in.", draft: "Hei! Logg inn, så ser vi på det.", signedIn: false });
    expect(String(asked[0].messages[0].content)).toContain("NOT signed in");
    // The customer never sees it (C5).
    const feed = await support.visitorFeed(owner.desk, c.id, 0);
    expect(feed.map((m) => m.author)).not.toContain("partner");
  });

  it("answers once per customer message, even when two ask at once (C23)", async () => {
    const c = await theirs(owner);
    const asked = model([final({ facts: [], recommendation: "First." }), final({ facts: [], recommendation: "Second." })]);
    const results = await Promise.all([runPartner(owner, c.id, { kind: "message", seq: c.seq }), runPartner(owner, c.id, { kind: "message", seq: c.seq })]);
    expect(results.filter((r) => r.ok && r.ran)).toHaveLength(1);
    expect(asked).toHaveLength(1);
    expect(await partnerMessages(c.id)).toHaveLength(1);
    // And not again for the same message.
    expect(await runPartner(owner, c.id, { kind: "message", seq: c.seq })).toEqual({ ok: true, ran: false });
  });

  it("does not run when the desk, the person or the conversation says no, or for someone who does not have it (C21)", async () => {
    model([final({ facts: [], recommendation: "Should not be asked." })]);
    const c = await theirs(owner);
    // Paused here.
    await support.setPartnerPaused(owner.desk, c.id, owner.account.id, true);
    expect(await runPartner(owner, c.id, { kind: "message", seq: c.seq })).toEqual({ ok: true, ran: false });
    await support.setPartnerPaused(owner.desk, c.id, owner.account.id, false);
    // The person's own switch.
    await support.setAgentPartner([owner.desk], owner.account.id, false);
    expect(await runPartner(owner, c.id, { kind: "message", seq: c.seq })).toEqual({ ok: true, ran: false });
    await support.setAgentPartner([owner.desk], owner.account.id, true);
    // The desk's switch.
    await db().execute(sql`update commerce.support_settings set partner = false where store_id = ${storeId}::uuid`);
    expect(await runPartner(owner, c.id, { kind: "message", seq: c.seq })).toEqual({ ok: true, ran: false });
    expect(await runPartner(owner, c.id, { kind: "question", text: "Anything?" })).toMatchObject({ ok: false });
    await db().execute(sql`update commerce.support_settings set partner = true where store_id = ${storeId}::uuid`);
    // Someone who does not have the conversation.
    expect(await runPartner(orderless, c.id, { kind: "message", seq: c.seq })).toEqual({ ok: true, ran: false });
    // Without a text model.
    ai.stores.delete(storeId);
    expect(await runPartner(owner, c.id, { kind: "message", seq: c.seq })).toEqual({ ok: true, ran: false });
    ai.stores.add(storeId);
    expect(await partnerMessages(c.id)).toHaveLength(0);
  });

  it("offers only what the person's role may read, and refuses a tool it was not offered (C22)", async () => {
    const c = await theirs(owner);
    await support.transition(owner.desk, c.id, "transfer", { kind: "agent", id: owner.account.id, name: "Kari" }, { target: null });
    await support.transition(orderless.desk, c.id, "claim", { kind: "agent", id: orderless.account.id, name: "Ola" });
    const seq = (await support.addMessage(orderless.desk, c.id, "customer", null, "Hello again"))!.seq;
    const asked = model([call("get_order", { number: "1042" }), final({ facts: [{ text: "Order 1042 was sent", tool: "get_order" }], recommendation: "Check the order." })]);
    expect(await runPartner(orderless, c.id, { kind: "message", seq })).toEqual({ ok: true, ran: true });
    expect(asked[0].tools).not.toContain("get_order");
    expect(asked[0].tools).not.toContain("list_customers");
    expect(asked[0].tools).toEqual(expect.arrayContaining(["list_products", "conversation_facts", "search_content"]));
    // The refused tool's fact is not kept.
    const [kept] = await partnerMessages(c.id);
    expect((kept.data as { facts: unknown[] }).facts).toEqual([]);
    // No tool that writes or waits for a yes is ever offered.
    expect(asked[0].tools.some((name) => /^(create|update|delete|send|set|refund|cancel)_/.test(name))).toBe(false);
  });

  it("keeps no draft for a customer who is not signed in once it read orders, and cleans a draft's claims (C24, C25)", async () => {
    const c = await theirs(owner);
    model([call("list_orders"), final({ facts: [{ text: "No orders found", tool: "list_orders" }], recommendation: "Ask them to sign in.", draft: "Your order 1042 was sent." })]);
    await runPartner(owner, c.id, { kind: "message", seq: c.seq });
    const [guarded] = await partnerMessages(c.id);
    expect(guarded.data).toMatchObject({ draft: null, recommendation: "Ask them to sign in." });

    const d = await theirs(owner);
    model([final({ facts: [], draft: "We have the lowest price in Norway. It ships today." })]);
    await runPartner(owner, d.id, { kind: "message", seq: d.seq });
    const [cleaned] = await partnerMessages(d.id);
    expect((cleaned.data as { draft: string }).draft).toBe("It ships today.");
  });

  it("answers a question from anyone who may answer the desk, and says when it could not", async () => {
    const c = await theirs(owner);
    model([final({ facts: [], answer: "Nothing in the store's pages says so." })]);
    expect(await runPartner(orderless, c.id, { kind: "question", text: "Do we gift-wrap?" })).toEqual({ ok: true, ran: true });
    const [answered] = await partnerMessages(c.id);
    expect(answered).toMatchObject({ kind: "answer", data: { question: "Do we gift-wrap?", answer: "Nothing in the store's pages says so." } });
    model([{ content: "I am not sure" }]);
    expect(await runPartner(orderless, c.id, { kind: "question", text: "And now?" })).toEqual({ ok: false, problem: "The partner could not answer just now." });
  });
});
