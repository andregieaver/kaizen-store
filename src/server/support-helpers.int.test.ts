import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));
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
const { agentAct } = await import("./support-agent");
const replies = await import("./support-replies");
const { systemDesk } = await import("./support-desk");
type Staff = import("./support-desk").StaffDesk;

/**
 * The agent's helpers (D216, step 13): saved replies are the desk's own and filled in for the conversation, and a translation, of
 * the customer's message or of the person's draft, is shown to the person only: nothing is written to the conversation or reaches
 * the customer until the person sends it, and what they send is marked *Translated by AI*.
 */

const run = Date.now().toString(36);
let storeId: string;
let owner: Staff;
let reader: Staff;
let other: Staff;

async function store(name: string) {
  const slug = `helpers-${name}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${`Fjell ${name}`}, null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${id}::uuid`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on, partner) values (${id}::uuid, 'people', false, false, false)`);
  const [o] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  await db().execute(sql`update commerce.accounts set name = 'Kari Nordmann' where id = ${String(o.id)}::uuid`);
  const staff: Staff = {
    desk: systemDesk(id),
    store: { id, slug, name: `Fjell ${name}` },
    account: { id: String(o.id), email: String(o.email), name: "Kari Nordmann" } as unknown as Staff["account"],
    canWrite: true,
    holder: { role: "owner" },
  };
  return { id, staff };
}

beforeAll(async () => {
  ({ id: storeId, staff: owner } = await store("a"));
  ({ staff: other } = await store("b"));
  ai.stores.add(storeId);
  reader = { ...owner, canWrite: false };
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => closeDb());

/** The model's answers in turn, keeping every request. */
function model(answers: string[]) {
  const asked: { role: string; content: string }[][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      asked.push((JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] }).messages);
      return Response.json({ choices: [{ message: { content: answers.shift() ?? "" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }),
  );
  return asked;
}

/** A Norwegian conversation the owner has, from a visitor who gave their name, with one customer message. */
async function conversation(contactName: string | null = "Per Olsen") {
  const [c] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, contact_name)
    values (${storeId}::uuid, 'site', 'queue', ${`h-${Math.random()}`}, 'nb-NO', ${contactName}) returning id
  `);
  const id = String(c.id);
  await support.transition(owner.desk, id, "claim", { kind: "agent", id: owner.account.id, name: "Kari" });
  const added = await support.addMessage(owner.desk, id, "customer", null, "Hvor er pakken min?");
  return { id, seq: added!.seq };
}

const messages = async (id: string) => db().execute<Row>(sql`select seq, author, body, data from commerce.support_messages where conversation_id = ${id}::uuid order by seq`);

describe("saved replies", () => {
  it("are the desk's own, with a shortcut no other reply of the desk has, and only those who may answer change them", async () => {
    const saved = await replies.saveReply(owner, { title: "Pakken", body: "Hei {customer_first_name}, dette er {agent_first_name} i {store}.", shortcut: "Pakke", locale: "nb-NO" });
    expect(saved.ok).toBe(true);
    expect(await replies.saveReply(owner, { title: "Again", body: "x", shortcut: "pakke" })).toEqual({ ok: false, problems: ["Another saved reply already has the shortcut /pakke."] });
    // Another store's desk may use the same shortcut, and does not see this one.
    expect((await replies.saveReply(other, { title: "Other", body: "y", shortcut: "pakke" })).ok).toBe(true);
    expect((await replies.listReplies(other)).map((r) => r.title)).toEqual(["Other"]);
    expect(await replies.saveReply(reader, { title: "No", body: "z", shortcut: "no" })).toMatchObject({ ok: false });
    if (!saved.ok) return;
    expect(await replies.deleteReply(other, saved.id)).toBe(false);
    const [logged] = await db().execute<Row>(sql`select area from commerce.audit_log where action = 'support.reply_added' and target_id = ${saved.id}`);
    expect(logged?.area).toBe("support");
  });

  it("are filled in for the conversation: the customer's first name, the person's name and the store", async () => {
    const c = await conversation();
    const result = await agentAct(owner, c.id, { kind: "replies" });
    expect(result).toMatchObject({ ok: true, locale: "nb-NO" });
    const reply = result.ok ? result.replies?.find((r) => r.shortcut === "pakke") : null;
    expect(reply?.body).toBe("Hei Per, dette er Kari i Fjell a.");
    // A visitor who gave no name: left out, never an email address.
    const nameless = await conversation(null);
    const filled = await agentAct(owner, nameless.id, { kind: "replies" });
    expect(filled.ok && filled.replies?.find((r) => r.shortcut === "pakke")?.body).toBe("Hei, dette er Kari i Fjell a.");
    // Another desk's conversation is not this desk's.
    expect(await agentAct(other, c.id, { kind: "replies" })).toMatchObject({ ok: false });
    // Picking one writes nothing.
    expect((await messages(c.id)).map((m) => m.author)).toEqual(["system", "customer"]);
  });
});

describe("translation for agents", () => {
  it("translates a customer's message for the person alone: nothing is written to the conversation", async () => {
    const c = await conversation();
    const asked = model(["Where is my parcel?"]);
    const before = await messages(c.id);
    expect(await agentAct(owner, c.id, { kind: "translate", seq: c.seq })).toEqual({ ok: true, text: "Where is my parcel?", language: "English" });
    // The customer's words go to the model between markers, as data.
    expect(asked[0][1].content).toContain("<text>\nHvor er pakken min?\n</text>");
    expect(await messages(c.id)).toEqual(before);
    // Only customers' messages.
    expect(await agentAct(owner, c.id, { kind: "translate", seq: 1 })).toMatchObject({ ok: false });
    // Not for those who only read, nor another desk.
    expect(await agentAct(reader, c.id, { kind: "translate", seq: c.seq })).toMatchObject({ ok: false });
    expect(await agentAct(other, c.id, { kind: "translate", seq: c.seq })).toMatchObject({ ok: false });
  });

  it("never sends a translated reply until the person sends it, and then marks it Translated by AI", async () => {
    const c = await conversation();
    const asked = model(["Pakken din er på vei."]);
    const translated = await agentAct(owner, c.id, { kind: "translate_reply", text: "Your parcel is on its way." });
    expect(translated).toMatchObject({ ok: true, text: "Pakken din er på vei.", language: "Norwegian Bokmål (Norway)" });
    expect(asked[0][0].content).toContain("into Norwegian Bokmål (Norway)");
    // Nothing reached the conversation, and the customer's feed holds nothing new.
    expect((await messages(c.id)).map((m) => m.author)).toEqual(["system", "customer"]);
    expect((await support.visitorFeed(owner.desk, c.id, 0)).map((m) => m.author)).not.toContain("agent");
    // The person sends it.
    expect(await agentAct(owner, c.id, { kind: "reply", body: "Pakken din er på vei.", translated: true })).toEqual({ ok: true });
    const sent = (await messages(c.id)).at(-1)!;
    expect(sent).toMatchObject({ author: "agent", body: "Pakken din er på vei." });
    expect(sent.data).toMatchObject({ translated: true });
    const seen = (await support.visitorFeed(owner.desk, c.id, 0)).at(-1)!;
    expect(seen.data?.translated).toBe(true);
    // A reply of the person's own words carries no mark.
    await agentAct(owner, c.id, { kind: "reply", body: "Ha en fin dag!" });
    expect(((await messages(c.id)).at(-1)!.data as { translated?: boolean }).translated).toBeUndefined();
  });

  it("says so without a text model, and an empty answer is no translation", async () => {
    const c = await conversation();
    model([""]);
    expect(await agentAct(owner, c.id, { kind: "translate_reply", text: "Hello" })).toMatchObject({ ok: false, problem: "The text could not be translated just now. Try again." });
    ai.stores.delete(storeId);
    expect(await agentAct(owner, c.id, { kind: "translate_reply", text: "Hello" })).toMatchObject({ ok: false });
    ai.stores.add(storeId);
    expect((await messages(c.id)).map((m) => m.author)).toEqual(["system", "customer"]);
  });
});
