import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));
// Kaizen's own chat assistant and a stand-in model, whatever the shared database holds for Kaizen.
vi.mock("./chat-agent", async (importOriginal) => {
  const real = await importOriginal<typeof import("./chat-agent")>();
  return {
    ...real,
    getChatAgent: async (storeId: string | null) =>
      storeId === null
        ? { storeId: null, enabled: true, name: "Kai", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 1000 }
        : real.getChatAgent(storeId),
  };
});
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  return {
    ...real,
    aiFor: async (storeId: string | null, ...rest: unknown[]) =>
      storeId === null
        ? ({ provider: "openai", source: "platform", apiUrl: "https://ai.example.com/v1", apiKey: "sk-test", textModel: "text-model", embeddingModel: null, space: null } as never)
        : (real.aiFor as (...args: unknown[]) => unknown)(storeId, ...rest),
  };
});

const kaizen = await import("./support-kaizen");
type Account = import("./auth").Account;

/**
 * Kaizen's desk for owners and staff (D216, step 11): an account's requests from the admin are its own (another account cannot list,
 * read or write in them), Kaizen's assistant answers with Kaizen's tools for that account, and a store's status is told only for a
 * store the account is a member of.
 */

const run = Date.now().toString(36);
let ana: Account;
let bo: Account;
let anaStore = "";
let boStore = "";

async function owner(name: string): Promise<{ account: Account; slug: string }> {
  const slug = `kz-${name}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${`Store of ${name}`}, null) as id`);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${String(created.id)}::uuid`);
  const [o] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  return { account: { id: String(o.id), email: String(o.email), name } as unknown as Account, slug };
}

/** The model's steps in turn, keeping the tool results it was given. */
function model(steps: Record<string, unknown>[]) {
  const results: string[] = [];
  const seen = new Set<string>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: { role: string; content: unknown; tool_call_id?: string }[] };
      // Each request carries the whole turn so far: keep each tool's result once.
      for (const message of body.messages) {
        if (message.role !== "tool" || seen.has(String(message.tool_call_id))) continue;
        seen.add(String(message.tool_call_id));
        results.push(String(message.content));
      }
      return Response.json({ choices: [{ message: steps.shift() ?? { content: "OK." } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }),
  );
  return results;
}
const call = (name: string, args: Record<string, unknown> = {}) => ({ content: null, tool_calls: [{ id: `c-${name}-${Math.random()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

beforeAll(async () => {
  ({ account: ana, slug: anaStore } = await owner("ana"));
  ({ account: bo, slug: boStore } = await owner("bo"));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => closeDb());

describe("an account's requests to Kaizena Flow", () => {
  it("are the account's own: another account cannot list, read or write in them", async () => {
    model([{ content: "Hello! How can I help?" }]);
    const answer = await kaizen.requesterTurn(ana, { message: "My checkout does not work.", aboutStore: anaStore, after: 0 });
    if ("status" in answer) throw new Error(answer.error);
    const id = answer.conversation.id;
    expect(answer.messages.map((m) => m.author)).toEqual(["customer", "ai"]);
    const [row] = await db().execute<Row>(sql`select store_id, source, requester_id, token_hash, about_store_id from commerce.support_conversations where id = ${id}::uuid`);
    expect(row).toMatchObject({ store_id: null, source: "admin", requester_id: ana.id, token_hash: null });
    expect(row.about_store_id).not.toBeNull();

    expect((await kaizen.requesterConversations(ana)).map((r) => r.id)).toContain(id);
    expect((await kaizen.requesterConversations(bo)).map((r) => r.id)).not.toContain(id);
    expect(await kaizen.requesterConversation(bo, id)).toBeNull();
    expect(await kaizen.requesterFeed(bo, id, 0)).toMatchObject({ status: 404 });
    expect(await kaizen.requesterTurn(bo, { conversation: id, message: "Let me in.", after: 0 })).toMatchObject({ status: 404 });
    expect(await kaizen.requesterEnd(bo, id)).toBe(false);
    // Ana's next message continues hers.
    model([{ content: "Let me look." }]);
    const next = await kaizen.requesterTurn(ana, { conversation: id, message: "Still broken.", after: 2 });
    if ("status" in next) throw new Error(next.error);
    expect(next.messages.map((m) => m.seq)).toEqual([3, 4]);
    expect(await kaizen.requesterEnd(ana, id)).toBe(true);
  });

  it("does not record a store the account is not a member of as what it is about", async () => {
    model([{ content: "Hi." }]);
    const answer = await kaizen.requesterTurn(ana, { message: "About someone else's store.", aboutStore: boStore, after: 0 });
    if ("status" in answer) throw new Error(answer.error);
    const [row] = await db().execute<Row>(sql`select about_store_id from commerce.support_conversations where id = ${answer.conversation.id}::uuid`);
    expect(row.about_store_id).toBeNull();
  });

  it("are answered with Kaizena Flow's tools for the account: its stores and their status only, and the admin's pages as chips", async () => {
    const results = model([
      call("my_stores"),
      call("store_status", { store: boStore }),
      call("store_status", { store: anaStore }),
      call("find_admin_page", { query: "payments card stripe" }),
      { content: "Here is where you set up payments." },
    ]);
    const answer = await kaizen.requesterTurn(ana, { message: "How do I take card payments?", aboutStore: anaStore, after: 0 });
    if ("status" in answer) throw new Error(answer.error);
    const [stores, theirs, mine, pages] = results.map((text) => JSON.parse(text));
    expect(stores.stores.map((s: { store: string }) => s.store)).toEqual([anaStore]);
    expect(theirs.error).toBe("not_found");
    expect(mine).toMatchObject({ store: anaStore, status: "active" });
    expect(Array.isArray(mine.featuresOn)).toBe(true);
    expect(pages.pages.length).toBeGreaterThan(0);
    const ai = answer.messages.find((m) => m.author === "ai")!;
    expect(ai.data?.chips?.length).toBeGreaterThan(0);
    for (const chip of ai.data!.chips!) expect(chip.href.startsWith(`/admin/${anaStore}`)).toBe(true);
  });

  it("tells a store's status only to its members", async () => {
    expect(await kaizen.storeStatus(ana.id, boStore)).toBeNull();
    expect(await kaizen.storeStatus(ana.id, anaStore)).toMatchObject({ store: anaStore });
    expect((await kaizen.myStores(bo.id)).map((s) => s.store)).toEqual([boStore]);
  });
});
