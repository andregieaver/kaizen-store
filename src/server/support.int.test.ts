import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// The visitor has no cookies: not signed in, no cart.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("./stripe", async (importOriginal) => ({ ...(await importOriginal<typeof import("./stripe")>()), platformStripe: () => ({}) }));

const { getStore } = await import("./stores");
const route = await import("./support-route");
const support = await import("./support");
const { systemDesk } = await import("./support-desk");
const { RETENTION_STEPS, runRetention } = await import("./retention");
const { exportCustomerData } = await import("./privacy-export");
const { eraseSubject } = await import("./privacy-erasure");
type ChatContext = import("./chat-route").ChatContext;
type AiConnection = import("./ai").AiConnection;
type VisitorReply = import("@/lib/support-visitor").VisitorReply;

/**
 * The chat keeps its conversations (D216, step 2; docs/support.md C1, C2, C16): a conversation is made on the first message and
 * continued with its token, the AI's history comes from the database, an ended one is reopened or replaced, and the retention,
 * export and erasure include it. The model is a stand-in (`fetch`); the routes' site check is `chatPlace()`, tested here through
 * `visitorPlace()`.
 */

const run = Date.now().toString(36);
const slug = `support-${run}`;
let storeId: string;
let context: ChatContext;

const connection = {
  provider: "openai",
  source: "platform",
  apiUrl: "https://ai.example.com/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  embeddingModel: null,
  space: null,
} as unknown as AiConnection;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Support test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${storeId}::uuid`);
  const store = (await getStore(slug))!;
  const market = store.markets.find((m) => m.code === "NO")!;
  context = {
    site: { kind: "store", store, market },
    storeId,
    lang: market.lang,
    locale: market.locale,
    market: market.slug,
    agent: { storeId, enabled: true, name: "Ingrid", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 },
    connection,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeDb();
});

/** The model answers each step in turn and keeps what it was sent; `fail` makes it answer with an error. */
function fakeModel(answers: string[], fail = false) {
  const sent: Row[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      sent.push(JSON.parse(String(init.body)) as Row);
      if (fail) return new Response("down", { status: 500 });
      return Response.json({ choices: [{ message: { content: answers.shift() ?? "…" } }] });
    }),
  );
  return sent;
}

const turn = async (message: string, ref?: { id: string; token: string }, after = 0) => {
  const answer = await route.visitorTurn(context, { conversation: ref, after, signals: { views: [], searches: [] } }, message);
  if (answer instanceof Response) return answer;
  return answer as VisitorReply;
};
const ok = (answer: VisitorReply | Response): VisitorReply => {
  if (answer instanceof Response) throw new Error(`expected a reply, got ${answer.status}`);
  return answer;
};
const conversationRow = async (id: string) => (await db().execute<Row>(sql`select * from commerce.support_conversations where id = ${id}::uuid`))[0];

describe("the chat keeps its conversations (C1, C2)", () => {
  it("makes a conversation on the first message, gives its token once, and continues it with the token", async () => {
    fakeModel(["Hei! Hva leter du etter?", "Vi har lamper."]);
    const first = ok(await turn("Hei"));
    expect(first.conversation?.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.conversation?.channel).toMatch(/^sc:[0-9a-f]{32}$/);
    expect(first.messages.map((m) => [m.seq, m.author, m.body])).toEqual([
      [1, "customer", "Hei"],
      [2, "ai", "Hei! Hva leter du etter?"],
    ]);
    expect(first.state).toMatchObject({ status: "open", handler: "ai", mode: "off", signedIn: false });
    const ref = { id: first.conversation!.id, token: first.conversation!.token! };

    // The desk was made with support off, and the token is kept only as a hash.
    const [desk] = await db().execute<Row>(sql`select mode from commerce.support_settings where store_id = ${storeId}::uuid`);
    expect(desk.mode).toBe("off");
    expect((await conversationRow(ref.id)).token_hash).not.toBe(ref.token);

    const second = ok(await turn("Har dere lamper?", ref, 2));
    expect(second.conversation?.token).toBeUndefined();
    expect(second.messages.map((m) => m.seq)).toEqual([3, 4]);
  });

  it("refuses a wrong token and another site's conversation as if it did not exist", async () => {
    fakeModel(["Hei!"]);
    const first = ok(await turn("Hei"));
    const id = first.conversation!.id;
    const wrong = await turn("Hei igjen", { id, token: "x".repeat(32) });
    expect(wrong).toBeInstanceOf(Response);
    expect((wrong as Response).status).toBe(404);
    // Kaizen's desk does not know a store's conversation.
    const elsewhere = await route.visitorFeedReply({}, { id, token: first.conversation!.token! }, 0);
    expect((elsewhere as Response).status).toBe(404);
    const feed = ok(await route.visitorFeedReply({ store: slug, market: "no" }, { id, token: first.conversation!.token! }, 1));
    expect(feed.messages.map((m) => m.author)).toEqual(["ai"]);
    expect((await conversationRow(id)).visitor_seen_at).not.toBeNull();
  });

  it("gives the AI its history from the database, the browser sending only the new message", async () => {
    const sent = fakeModel(["Svar 1", "Svar 2"]);
    const first = ok(await turn("Første spørsmål"));
    const ref = { id: first.conversation!.id, token: first.conversation!.token! };
    ok(await turn("Andre spørsmål", ref, 2));
    const history = (sent[1].messages as Row[]).filter((m) => m.role !== "system").map((m) => [m.role, m.content]);
    expect(history).toEqual([
      ["user", "Første spørsmål"],
      ["assistant", "Svar 1"],
      ["user", "Andre spørsmål"],
    ]);
  });

  it("keeps a long conversation's history to the last 20 messages, so a spoken question still fits", async () => {
    const sent = fakeModel(["Svar"]);
    const first = ok(await turn("Start"));
    const desk = systemDesk(storeId);
    for (let i = 0; i < 15; i++) {
      await support.addMessage(desk, first.conversation!.id, "customer", null, `Spørsmål ${i}`);
      await support.addMessage(desk, first.conversation!.id, "ai", null, `Svar ${i}`);
    }
    sent.length = 0;
    const said = ok(await turn("Det jeg sa høyt", { id: first.conversation!.id, token: first.conversation!.token! }, 32));
    expect(said.messages.map((m) => m.author)).toEqual(["customer", "ai"]);
    const history = (sent[0].messages as Row[]).filter((m) => m.role !== "system");
    expect(history).toHaveLength(20);
    expect(history.at(-1)).toMatchObject({ role: "user", content: "Det jeg sa høyt" });
  });

  it("keeps the message when the AI fails, and says so", async () => {
    fakeModel([], true);
    const answer = ok(await turn("Hallo?"));
    expect(answer.error).toBeTruthy();
    expect(answer.messages.map((m) => m.author)).toEqual(["customer"]);
    expect(answer.conversation?.token).toBeTruthy();
  });

  it("reopens an ended conversation within a day, and starts a new one after", async () => {
    fakeModel(["Hei!", "Hei igjen!", "Ny samtale."]);
    const first = ok(await turn("Hei"));
    const ref = { id: first.conversation!.id, token: first.conversation!.token! };
    const ended = ok(await route.visitorEnd({ store: slug, market: "no" }, ref, 2));
    expect(ended.state.status).toBe("ended");
    expect(ended.messages.map((m) => m.kind)).toEqual(["ended"]);
    expect((await conversationRow(ref.id)).ended_by).toBe("customer");

    const again = ok(await turn("Glemte noe", ref, 3));
    expect(again.conversation?.token).toBeUndefined();
    expect(again.messages.map((m) => m.kind ?? m.author)).toEqual(["reopened", "customer", "ai"]);

    await route.visitorEnd({ store: slug, market: "no" }, ref, 0);
    await db().execute(sql`update commerce.support_conversations set ended_at = now() - interval '2 days' where id = ${ref.id}::uuid`);
    const fresh = ok(await turn("Hei på nytt", ref, 99));
    expect(fresh.conversation?.id).not.toBe(ref.id);
    expect(fresh.conversation?.token).toBeTruthy();
    expect(fresh.messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("asks for a new conversation once one is very long", async () => {
    fakeModel(["Hei!"]);
    const first = ok(await turn("Hei"));
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.support_writer', 'on', true)`);
      await tx.execute(sql`update commerce.support_conversations set message_seq = 300 where id = ${first.conversation!.id}::uuid`);
    });
    const full = await turn("En til", { id: first.conversation!.id, token: first.conversation!.token! }, 2);
    expect((full as Response).status).toBe(409);
  });

  it("counts the visitor's turns before the model is asked, as before", async () => {
    const { takeTurn } = await import("./chat-route");
    const tight = { ...context, agent: { ...context.agent, dailyLimit: 0 } };
    const refused = await takeTurn(tight, new Request("https://example.com/api/chat", { headers: { "x-forwarded-for": "192.0.2.77" } }));
    expect(refused?.status).toBe(429);
  });
});

describe("ending, retention, export and erasure (C16)", () => {
  const noSteps = () => Object.fromEntries(RETENTION_STEPS.filter((s) => !s.startsWith("support_")).map((s) => [s, async () => ({ count: 0 })]));

  it("ends conversations with the AI that went quiet for the desk's time", async () => {
    fakeModel(["Hei!"]);
    const first = ok(await turn("Hei"));
    await db().execute(sql`update commerce.support_conversations set last_message_at = now() - interval '2 hours' where id = ${first.conversation!.id}::uuid`);
    expect(await support.endIdleConversations()).toBeGreaterThanOrEqual(1);
    expect(await conversationRow(first.conversation!.id)).toMatchObject({ status: "ended", ended_by: "timeout" });
  });

  it("anonymises a transcript a day after it ends with support off, and deletes the record after 24 months", async () => {
    fakeModel(["Hei!"]);
    const first = ok(await turn("Mitt telefonnummer er 99999999"));
    const id = first.conversation!.id;
    await route.visitorEnd({ store: slug, market: "no" }, { id, token: first.conversation!.token! }, 0);
    // Not yet: ended just now.
    await runRetention(new Date(), { steps: noSteps() });
    expect((await conversationRow(id)).anonymised_at).toBeNull();

    await db().execute(sql`update commerce.support_conversations set ended_at = now() - interval '25 hours' where id = ${id}::uuid`);
    const ran = await runRetention(new Date(), { steps: noSteps() });
    expect(ran.counts.support_transcripts).toBeGreaterThanOrEqual(1);
    const row = await conversationRow(id);
    expect(row).toMatchObject({ token_hash: null, page_path: null, customer_id: null });
    expect(row.anonymised_at).not.toBeNull();
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.support_messages where conversation_id = ${id}::uuid`);
    expect(left.n).toBe(0);
    // The old token opens nothing now.
    expect((await route.visitorFeedReply({ store: slug, market: "no" }, { id, token: first.conversation!.token! }, 0)) as Response).toHaveProperty("status", 404);

    await db().execute(sql`update commerce.support_conversations set ended_at = now() - interval '25 months' where id = ${id}::uuid`);
    await runRetention(new Date(), { steps: noSteps() });
    expect(await conversationRow(id)).toBeUndefined();
  });

  it("puts a customer's conversations in their export (never notes) and anonymises them on erasure", async () => {
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${`kari-${run}@example.com`}, 'Kari') returning id`);
    const customerId = String(customer.id);
    fakeModel(["Hei Kari!"]);
    const first = ok(await turn("Hei"));
    const id = first.conversation!.id;
    await support.claimForCustomer(systemDesk(storeId), id, customerId);
    await support.addMessage(systemDesk(storeId), id, "note", null, "Internal: VIP");

    const exported = await exportCustomerData(storeId, { customerId }, { channel: "staff", accountId: null });
    if (!exported.ok) throw new Error(exported.problem);
    const section = exported.file.sections.support as { messages: { from: string; text: string }[] }[];
    expect(exported.file.counts.support).toBe(1);
    expect(section[0].messages.map((m) => [m.from, m.text])).toEqual([
      ["customer", "Hei"],
      ["ai", "Hei Kari!"],
    ]);
    expect(JSON.stringify(exported.file)).not.toContain("Internal: VIP");

    const erased = await eraseSubject(storeId, { customerId }, { channel: "staff", accountId: null }, { avatarRemover: async () => {} });
    expect(erased).toMatchObject({ ok: true });
    const row = await conversationRow(id);
    expect(row.anonymised_at).not.toBeNull();
    expect(row.customer_id).toBeNull();
    expect(row.status).toBe("ended");
  });
});

describe("the inbox at three levels sees only its desks (C15, step 3)", () => {
  const desks = async () => import("./support-desk");

  async function newStore(name: string) {
    const s = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${run}`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${s}@example.com`}, 'T', 'T') returning id`);
    const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${s}, ${name}, null) as id`);
    const [owner] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${s}@example.com`}`);
    return { id: String(created.id), slug: s, owner: { id: String(owner.id), email: String(owner.email) } };
  }

  /** A conversation made straight in the database on a desk (the visitor's route is tested above). */
  async function conversationOn(storeId: string | null, words: string) {
    const [c] = await db().execute<Row>(sql`
      insert into commerce.support_conversations (store_id, source, handler, token_hash, locale)
      values (${storeId}::uuid, 'site', 'ai', ${`h-${Math.random()}`}, 'en') returning id`);
    const id = String(c.id);
    await support.addMessage(systemDesk(storeId), id, "customer", null, words);
    return id;
  }

  it("lists a store's conversations to its own desk only, and refuses another desk's conversation", async () => {
    const a = await newStore("Inbox A");
    const b = await newStore("Inbox B");
    const inA = await conversationOn(a.id, "Question to A");
    const inB = await conversationOn(b.id, "Question to B");
    const kaizen = await conversationOn(null, "Question to Kaizen");

    const listA = await support.staffList([systemDesk(a.id)], a.owner.id, { tab: "ai" });
    expect(listA.map((r) => r.id)).toEqual([inA]);
    expect(listA[0]).toMatchObject({ preview: "Question to A", unread: true, handler: "ai" });
    expect(await support.staffConversation(systemDesk(a.id), inB)).toBeNull();
    expect(await support.staffConversation(systemDesk(null), inA)).toBeNull();
    const kaizenList = await support.staffList([systemDesk(null)], a.owner.id, { tab: "open" });
    expect(kaizenList.map((r) => r.id)).toContain(kaizen);
    expect(kaizenList.map((r) => r.id)).not.toContain(inA);

    // Reading it marks it read for that person only.
    const seen = await support.staffConversation(systemDesk(a.id), inA);
    await support.markRead(systemDesk(a.id), inA, a.owner.id, seen!.messageSeq);
    expect((await support.staffList([systemDesk(a.id)], a.owner.id, { tab: "ai" }))[0].unread).toBe(false);
    await expect(support.markRead(systemDesk(b.id), inA, a.owner.id, 1)).rejects.toThrow();
  });

  it("gives the owner's level every store where the account may read support, and no other", async () => {
    const { ownerDesks } = await desks();
    const a = await newStore("Owner A");
    const b = await newStore("Owner B");
    // The owner of A is a member of B with a role that may read orders but not support.
    const [role] = await db().execute<Row>(sql`insert into commerce.store_roles (store_id, name, permissions) values (${b.id}::uuid, 'Orders only', array['orders:read']::text[]) returning id`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role, role_id) values (${b.id}::uuid, ${a.owner.id}::uuid, 'admin', ${String(role.id)}::uuid)`);
    const account = { id: a.owner.id, email: a.owner.email } as never;
    expect((await ownerDesks(account)).map((d) => d.store?.slug)).toEqual([a.slug]);

    // With support:read the store joins the list, read-only.
    await db().execute(sql`update commerce.store_roles set permissions = array['orders:read', 'support:read']::text[] where id = ${String(role.id)}::uuid`);
    const both = await ownerDesks(account);
    expect(both.map((d) => [d.store?.slug, d.canWrite]).sort()).toEqual([[a.slug, true], [b.slug, false]].sort());
    const inB = await conversationOn(b.id, "Hello B");
    const rows = await support.staffList(both.map((d) => d.desk), a.owner.id, { tab: "open" });
    expect(rows.find((r) => r.id === inB)?.store).toEqual({ slug: b.slug, name: "Owner B" });
  });

  it("keeps presence per desk, and counts an agent online only while their heartbeat is fresh", async () => {
    const a = await newStore("Presence");
    const desk = systemDesk(a.id);
    expect((await support.presence(desk, a.owner.id)).status).toBe("away");
    await support.setPresence([desk], a.owner.id, "online");
    expect((await support.presence(desk, a.owner.id)).status).toBe("online");
    expect(await support.onlineCount(desk)).toBe(1);
    await db().execute(sql`update commerce.support_agents set last_seen_at = now() - interval '5 minutes' where store_id = ${a.id}::uuid`);
    expect(await support.onlineCount(desk)).toBe(0);
    await support.heartbeat([desk], a.owner.id);
    expect(await support.onlineCount(desk)).toBe(1);
    expect(await support.waitingCount([desk])).toBe(0);
  });
});

describe("a person takes over, answers and hands back (C4, C5, C6, step 4)", () => {
  async function setMode(storeId: string, mode: string) {
    await db().execute(sql`
      insert into commerce.support_settings (store_id, mode) values (${storeId}::uuid, ${mode})
      on conflict on constraint support_settings_store_key do update set mode = excluded.mode
    `);
  }

  async function agentDesk(name: string) {
    const s = `${name}-${run}`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${s}@example.com`}, 'T', 'T') returning id`);
    const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${s}, ${name}, null) as id`);
    const [owner] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${s}@example.com`}`);
    await db().execute(sql`update commerce.accounts set name = 'Kari Nordmann' where id = ${String(owner.id)}::uuid`);
    const [second] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`ola-${s}@example.com`}, 'Ola Hansen') returning id`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${String(created.id)}::uuid, ${String(second.id)}::uuid, 'admin')`);
    const store = { id: String(created.id), slug: s, name };
    type Staff = import("./support-desk").StaffDesk;
    const staff = (id: string, email: string): Staff => ({ desk: systemDesk(store.id), store, account: { id, email } as unknown as Staff["account"], canWrite: true });
    return { store, kari: staff(String(owner.id), String(owner.email)), ola: staff(String(second.id), `ola-${s}@example.com`) };
  }

  it("lets one person take over, drops the AI's late answer, shows the customer who joined and what they wrote, and keeps notes from them", async () => {
    const { agentAct } = await import("./support-agent");
    const { store, kari, ola } = await agentDesk("handover");
    await setMode(store.id, "ai_first");
    const id = await (async () => {
      const [c] = await db().execute<Row>(sql`insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values (${store.id}::uuid, 'site', 'ai', ${`t-${run}`}, 'en') returning id`);
      return String(c.id);
    })();
    await support.addMessage(systemDesk(store.id), id, "customer", null, "Where is my parcel?");

    expect(await agentAct(kari, id, { kind: "claim" })).toEqual({ ok: true });
    // A second person is told who has it (C6).
    expect(await agentAct(ola, id, { kind: "claim" })).toEqual({ ok: false, problem: "Kari Nordmann has this conversation now." });
    // The AI's answer that was on its way is dropped (C4).
    expect(await support.addMessage(systemDesk(store.id), id, "ai", null, "Late answer")).toBeNull();
    // Only the one who has it answers.
    expect(await agentAct(ola, id, { kind: "reply", body: "Hi from Ola" })).toEqual({ ok: false, problem: "This conversation is not yours to answer." });
    expect(await agentAct(kari, id, { kind: "reply", body: "I'll look it up." })).toEqual({ ok: true });
    expect(await agentAct(ola, id, { kind: "note", body: "VIP customer" })).toEqual({ ok: true });

    // The customer sees who joined and the answer with the person's first name, never a note (C5).
    const feed = await support.visitorFeed(systemDesk(store.id), id, 0);
    expect(feed.map((m) => m.kind ?? m.author)).toEqual(["customer", "joined", "agent"]);
    expect(feed[1].data).toEqual({ name: "Kari" });
    expect(feed[2]).toMatchObject({ body: "I'll look it up.", data: { name: "Kari", picture: null } });
    expect(JSON.stringify(feed)).not.toContain("VIP");
    const row = (await db().execute<Row>(sql`select handler, assignee_id from commerce.support_conversations where id = ${id}::uuid`))[0];
    expect(row).toMatchObject({ handler: "human", assignee_id: kari.account.id });

    // The activity log says who took it over, under Support.
    const [logged] = await db().execute<Row>(sql`select area from commerce.audit_log where action = 'support.claimed' and target_id = ${id}`);
    expect(logged.area).toBe("support");
  });

  it("hands over to a person of the desk or the queue, gives back to the AI, and ends", async () => {
    const { agentAct } = await import("./support-agent");
    const { store, kari, ola } = await agentDesk("transfer");
    await setMode(store.id, "ai_first");
    const [c] = await db().execute<Row>(sql`insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values (${store.id}::uuid, 'site', 'ai', ${`u-${run}`}, 'en') returning id`);
    const id = String(c.id);
    await support.addMessage(systemDesk(store.id), id, "customer", null, "Hello");
    await agentAct(kari, id, { kind: "claim" });

    // Not to someone who does not answer on the desk.
    expect(await agentAct(kari, id, { kind: "transfer", target: ola.account.id })).toEqual({ ok: false, problem: "That person does not answer on this desk." });
    await support.setPresence([systemDesk(store.id)], ola.account.id, "online");
    expect(await agentAct(kari, id, { kind: "transfer", target: ola.account.id })).toEqual({ ok: true });
    expect(await agentAct(ola, id, { kind: "transfer", target: null })).toEqual({ ok: true });
    expect((await db().execute<Row>(sql`select handler from commerce.support_conversations where id = ${id}::uuid`))[0].handler).toBe("queue");
    await agentAct(ola, id, { kind: "claim" });
    expect(await agentAct(ola, id, { kind: "hand_back" })).toEqual({ ok: true });
    const lines = (await support.visitorFeed(systemDesk(store.id), id, 0)).filter((m) => m.author === "system").map((m) => m.kind);
    expect(lines).toEqual(["joined", "joined", "queued", "joined", "left", "assistant_back"]);

    await agentAct(kari, id, { kind: "claim" });
    expect(await agentAct(kari, id, { kind: "ask_sign_in" })).toEqual({ ok: true });
    expect(await agentAct(kari, id, { kind: "end" })).toEqual({ ok: true });
    expect(await agentAct(kari, id, { kind: "reply", body: "Too late" })).toEqual({ ok: false, problem: "This conversation has ended." });
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where target_id = ${id} and action like 'support.%'`))[0].n).toBe(7);
  });

  it("lets nobody take over while support is off, and someone who only reads do nothing", async () => {
    const { agentAct } = await import("./support-agent");
    const { store, kari } = await agentDesk("off-desk");
    await setMode(store.id, "off");
    const [c] = await db().execute<Row>(sql`insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values (${store.id}::uuid, 'site', 'ai', ${`v-${run}`}, 'en') returning id`);
    expect(await agentAct(kari, String(c.id), { kind: "claim" })).toEqual({ ok: false, problem: "Support is switched off for this desk." });
    expect(await agentAct({ ...kari, canWrite: false }, String(c.id), { kind: "note", body: "x" })).toEqual({ ok: false, problem: "You can read this desk's conversations but not answer them." });
  });

  it("does not ask the AI while a person has the conversation", async () => {
    const { agentAct } = await import("./support-agent");
    await setMode(storeId, "ai_first");
    const sent = fakeModel(["Hei!"]);
    const first = ok(await turn("Hei"));
    const ref = { id: first.conversation!.id, token: first.conversation!.token! };
    const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid and role = 'owner' limit 1`);
    type Staff = import("./support-desk").StaffDesk;
    const kari: Staff = { desk: systemDesk(storeId), store: { id: storeId, slug, name: "Support test" }, account: { id: String(owner.account_id), email: "x@example.com" } as unknown as Staff["account"], canWrite: true };
    expect(await agentAct(kari, ref.id, { kind: "claim" })).toEqual({ ok: true });
    const before = sent.length;
    const next = ok(await turn("Are you there?", ref, 2));
    expect(sent.length).toBe(before);
    expect(next.messages.map((m) => m.kind ?? m.author)).toEqual(["joined", "customer"]);
    expect(next.state).toMatchObject({ handler: "human", agent: { name: expect.any(String) } });
    await setMode(storeId, "off");
  });
});
