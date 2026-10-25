import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const ownerTools = await import("./owner-tools");
const support = await import("./support");
const { systemDesk } = await import("./support-desk");
const { replyApprovalSummary } = await import("./support-manager-tools");

type Row = Record<string, unknown>;

/**
 * The AI manager's support tools (PSI AGT-01): a conversation read as the inbox reads it (no partner's help, no contact details), a note
 * only staff see, a reply in the person's name that takes the conversation over first and is refused for another person's or an ended
 * one, and ending one the person has. Everything goes through the inbox's own `agentAct()`.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const ctx = async () => ({ account: store.account, store: (await getStore(store.slug))!, invalidate: () => {} });
const run = async (name: string, args: unknown) => ownerTools.runOwnerTool(await ctx(), name, args);

async function conversation(words: string): Promise<string> {
  const [c] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, contact_email)
    values (${store.id}::uuid, 'site', 'queue', ${`m-${Math.random()}`}, 'nb-NO', 'kunde@example.com') returning id
  `);
  const id = String(c.id);
  await support.addMessage(systemDesk(store.id), id, "customer", null, words);
  return id;
}

const messages = async (id: string) =>
  db().execute<Row>(sql`select author, body, account_id from commerce.support_messages where conversation_id = ${id}::uuid and author <> 'system' order by seq`);

beforeAll(async () => {
  store = await makeStore("support-tools");
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.id}::uuid`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on) values (${store.id}::uuid, 'people', false, false)`);
});

afterAll(async () => closeDb());

describe("the support tools", () => {
  it("reads a conversation as staff do, without the partner's help or the customer's address, and lists its id", async () => {
    const id = await conversation("Hvor er pakken min?");
    await support.addMessage(systemDesk(store.id), id, "partner", store.account.id, "Partner: check the order first.");
    await support.addMessage(systemDesk(store.id), id, "note", store.account.id, "Looked at the order.");
    const read = (await run("get_support_conversation", { conversation: id })) as { status: string; transcript: string; link: string };
    expect(read.status).toBe("waiting for a person");
    expect(read.transcript).toContain("Customer: Hvor er pakken min?");
    expect(read.transcript).toContain("Staff note");
    expect(read.transcript).not.toContain("Partner:");
    expect(JSON.stringify(read)).not.toContain("kunde@example.com");
    const listed = (await run("list_support_conversations", { status: "open" })) as { conversations: { id: string }[] };
    expect(listed.conversations.map((c) => c.id)).toContain(id);
    await expect(run("get_support_conversation", { conversation: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/no such conversation/);
  });

  it("writes a note only staff see, and replies in the person's name after taking the conversation over", async () => {
    const id = await conversation("Kan jeg bytte størrelse?");
    expect(await run("add_support_note", { conversation: id, note: "Size M is in stock." })).toMatchObject({ done: expect.stringContaining("only staff") });
    const c = await ctx();
    await ownerTools.preflightOwnerTool(c, "reply_to_support", { conversation: id, message: "Ja, det går fint." });
    expect(await replyApprovalSummary(c, { conversation: id, message: "Ja, det går fint." })).toBe(
      'Reply in the support conversation in your name (you take the conversation over first, as in the inbox): "Ja, det går fint."',
    );
    const done = await run("reply_to_support", { conversation: id, message: "Ja, det går fint." });
    expect(done).toMatchObject({ done: expect.stringContaining("took the conversation over") });
    expect((await messages(id)).map((m) => [m.author, m.body])).toEqual([
      ["customer", "Kan jeg bytte størrelse?"],
      ["note", "Size M is in stock."],
      ["agent", "Ja, det går fint."],
    ]);
    const [row] = await db().execute<Row>(sql`select handler, assignee_id from commerce.support_conversations where id = ${id}::uuid`);
    expect(row).toMatchObject({ handler: "human", assignee_id: store.account.id });

    // Its claims are refused before the person is asked.
    await expect(ownerTools.preflightOwnerTool(c, "reply_to_support", { conversation: id, message: "Only today: the best price ever." })).rejects.toThrow(/claims/);

    expect(await run("end_support_conversation", { conversation: id })).toMatchObject({ done: expect.stringContaining("Ended") });
    await expect(ownerTools.preflightOwnerTool(c, "reply_to_support", { conversation: id, message: "Hei igjen." })).rejects.toThrow(/has ended/);
  });

  it("refuses another person's conversation, and a member who may only read", async () => {
    const other = await makeAccount("Ola");
    await addMember(store.id, other.id, "admin");
    const id = await conversation("Hei!");
    await support.transition(systemDesk(store.id), id, "claim", { kind: "agent", id: other.id, name: "Ola" });
    const c = await ctx();
    await expect(ownerTools.preflightOwnerTool(c, "reply_to_support", { conversation: id, message: "Hei." })).rejects.toThrow(/Ola has this conversation/);
    await expect(run("end_support_conversation", { conversation: id })).rejects.toThrow();

    const reader = { ...c, holder: { role: "admin" as const, permissions: ["support:read"] } };
    await expect(ownerTools.runOwnerTool(reader, "add_support_note", { conversation: id, note: "x" })).rejects.toThrow(ownerTools.OwnerToolError);
    expect(await ownerTools.runOwnerTool(reader, "get_support_conversation", { conversation: id })).toMatchObject({ status: "with Ola" });
  });
});
