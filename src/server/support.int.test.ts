import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// The visitor has no cookies: not signed in, no cart.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
// Work the routes leave for after the answer (the tone, step 6) is kept here for the tests to run.
const background = vi.hoisted(() => ({ tasks: [] as (() => unknown)[], aiStores: new Set<string>() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => background.tasks.push(task),
}));
// Stores in `aiStores` have a text model (the stand-in answers through `fetch`); the rest as the database says.
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  return {
    ...real,
    aiFor: async (storeId: string | null, ...rest: unknown[]) =>
      storeId && background.aiStores.has(storeId)
        ? ({ provider: "openai", source: "store", apiUrl: "https://ai.example.com/v1", apiKey: "sk-test", textModel: "text-model", embeddingModel: null, space: null } as never)
        : (real.aiFor as (...args: unknown[]) => unknown)(storeId, ...rest),
  };
});
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
    agent: { storeId, enabled: true, name: "Ingrid", occupation: "", avatar: null, avatarStyle: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 },
    connection,
    settings: await support.ensureDesk(systemDesk(storeId)),
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

/** A visitor's message on the test store, with the desk's settings as they are now (the routes read them per request). */
const turn = async (message: string, ref?: { id: string; token: string }, after = 0) => {
  const settings = await support.ensureDesk(systemDesk(storeId));
  const answer = await route.visitorTurn({ ...context, settings }, { conversation: ref, after, signals: { views: [], searches: [] } }, message);
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
    const tight = { ...context, agent: { ...context.agent!, dailyLimit: 0 } };
    const refused = await takeTurn(tight, new Request("https://example.com/api/chat", { headers: { "x-forwarded-for": "192.0.2.77" } }));
    expect((refused as Response).status).toBe(429);
    // With the AI first, the site's daily limit hands the conversation to a person instead (2.12).
    const handing = await takeTurn({ ...tight, settings: { ...tight.settings, mode: "ai_first" } }, new Request("https://example.com/api/chat", { headers: { "x-forwarded-for": "192.0.2.78" } }));
    expect(handing).toBe("limit");
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
    const staff = (id: string, email: string): Staff => ({ desk: systemDesk(store.id), store, account: { id, email } as unknown as Staff["account"], canWrite: true, holder: { role: "owner" } });
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
    const kari: Staff = { desk: systemDesk(storeId), store: { id: storeId, slug, name: "Support test" }, account: { id: String(owner.account_id), email: "x@example.com" } as unknown as Staff["account"], canWrite: true, holder: { role: "owner" } };
    expect(await agentAct(kari, ref.id, { kind: "claim" })).toEqual({ ok: true });
    const before = sent.length;
    const next = ok(await turn("Are you there?", ref, 2));
    expect(sent.length).toBe(before);
    expect(next.messages.map((m) => m.kind ?? m.author)).toEqual(["joined", "customer"]);
    expect(next.state).toMatchObject({ handler: "human", agent: { name: expect.any(String) } });
    await setMode(storeId, "off");
  });
});

describe("asking for a person, and the two modes (step 5: C7, C8, C20)", () => {
  type Staff = import("./support-desk").StaffDesk;

  /** A new open store with its desk in `mode`, its owner, and a visitor's context on it (with or without the AI). */
  async function desk(name: string, mode: "off" | "ai_first" | "people", ai = false) {
    const s = `${name}-${run}`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${s}@example.com`}, 'T', 'T') returning id`);
    const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${s}, ${name}, null) as id`);
    const id = String(created.id);
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${id}::uuid`);
    await db().execute(sql`
      insert into commerce.support_settings (store_id, mode) values (${id}::uuid, ${mode})
      on conflict on constraint support_settings_store_key do update set mode = excluded.mode
    `);
    const [owner] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${s}@example.com`}`);
    await db().execute(sql`update commerce.accounts set name = 'Kari Nordmann' where id = ${String(owner.id)}::uuid`);
    const store = (await getStore(s))!;
    const market = store.markets.find((m) => m.code === "NO")!;
    const settings = await support.ensureDesk(systemDesk(id));
    const ctx: ChatContext = {
      site: { kind: "store", store, market },
      storeId: id,
      lang: market.lang,
      locale: market.locale,
      market: market.slug,
      agent: ai ? { storeId: id, enabled: true, name: "Ingrid", occupation: "", avatar: null, avatarStyle: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 } : null,
      connection: ai ? connection : null,
      settings,
    };
    const kari: Staff = { desk: systemDesk(id), store: { id, slug: s, name }, account: { id: String(owner.id), email: String(owner.email) } as unknown as Staff["account"], canWrite: true, holder: { role: "owner" } };
    return { id, slug: s, store, market, ctx, kari, raw: { store: s, market: market.slug } };
  }

  const say = async (ctx: ChatContext, message: string, ref?: { id: string; token: string }, after = 0, options: { limited?: boolean } = {}) =>
    ok(await route.visitorTurn(ctx, { conversation: ref, after, signals: { views: [], searches: [] } }, message, options));
  const refOf = (reply: VisitorReply) => ({ id: reply.conversation!.id, token: reply.conversation!.token! });

  it("with people only, starts every conversation in the queue, never asks the AI and stores no AI message (C20)", async () => {
    const sent = fakeModel(["Should never be asked"]);
    const d = await desk("people-only", "people");
    const first = await say(d.ctx, "Hei, er dere der?");
    expect(sent).toHaveLength(0);
    expect(first.messages.map((m) => m.author)).toEqual(["customer"]);
    expect(first.state).toMatchObject({ status: "open", handler: "queue", mode: "people", queue: { position: 1 }, available: false, emailFollowup: true, followupEmail: null });
    // An answer from the AI is dropped by the database: the conversation is not the AI's.
    expect(await support.addMessage(systemDesk(d.id), first.conversation!.id, "ai", null, "Hello")).toBeNull();
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.support_messages where conversation_id = ${first.conversation!.id}::uuid and author = 'ai'`))[0].n).toBe(0);

    // The chat is served without an agent or a model; with support off it is not.
    const { chatContext } = await import("./chat-route");
    const place = { site: d.ctx.site, storeId: d.id, lang: d.ctx.lang, locale: d.ctx.locale, market: d.ctx.market };
    expect(await chatContext(place)).toMatchObject({ agent: null, connection: null, settings: { mode: "people" } });
    await db().execute(sql`update commerce.support_settings set mode = 'off' where store_id = ${d.id}::uuid`);
    expect(((await chatContext(place)) as Response).status).toBe(404);
  });

  it("with the AI first but no AI, or an AI that fails, moves the conversation to the queue (C8)", async () => {
    const none = await desk("no-model", "ai_first");
    const first = await say(none.ctx, "Hello?");
    expect(first.state.handler).toBe("queue");
    expect(first.messages.map((m) => m.kind ?? m.author)).toEqual(["customer", "queued"]);
    expect((await conversationRow(first.conversation!.id)).handoff_reason).toBe("no_ai");

    const failing = await desk("failing-ai", "ai_first", true);
    fakeModel([], true);
    const failed = await say(failing.ctx, "Hello?");
    expect(failed.state.handler).toBe("queue");
    expect(failed.error).toBeUndefined();
    expect((await conversationRow(failed.conversation!.id)).handoff_reason).toBe("no_ai");

    // Past the site's daily limit the message is kept and goes to a person, without asking the model.
    const limited = await desk("limited-ai", "ai_first", true);
    const sent = fakeModel(["Never"]);
    const over = await say(limited.ctx, "Hello?", undefined, 0, { limited: true });
    expect(sent).toHaveLength(0);
    expect((await conversationRow(over.conversation!.id)).handoff_reason).toBe("limit");
  });

  it("hands over when the AI asks for a person, keeping its words for the staff", async () => {
    const d = await desk("ai-handoff", "ai_first", true);
    const answers: unknown[] = [
      { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "handoff_to_human", arguments: JSON.stringify({ reason: "Wants a refund for a broken lamp" }) } }] },
      { content: "A person from the store will answer here." },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ choices: [{ message: answers.shift() ?? { content: "…" } }] })),
    );
    const reply = await say(d.ctx, "I want to talk to someone about a refund");
    expect(reply.state.handler).toBe("queue");
    expect(reply.messages.map((m) => m.kind ?? m.author)).toEqual(["customer", "ai", "queued"]);
    expect(await conversationRow(reply.conversation!.id)).toMatchObject({ handoff_reason: "ai", ai_reason: "Wants a refund for a broken lamp" });
  });

  it("lets the visitor ask for a person and go back to the assistant, with their place in line", async () => {
    const d = await desk("talk-to-person", "ai_first", true);
    fakeModel(["Hei!", "Hei igjen!"]);
    const a = await say(d.ctx, "Hei");
    const b = await say(d.ctx, "Hei");
    const asked = ok(await route.visitorHandoff(d.raw, refOf(a), 2));
    expect(asked.state).toMatchObject({ handler: "queue", queue: { position: 1 } });
    expect(asked.messages.map((m) => m.kind)).toEqual(["queued"]);
    const second = ok(await route.visitorHandoff(d.raw, refOf(b), 2));
    expect(second.state.queue).toEqual({ position: 2 });
    expect((await conversationRow(a.conversation!.id)).handoff_reason).toBe("customer");

    const back = ok(await route.visitorAssistant(d.raw, refOf(a), 3));
    expect(back.state.handler).toBe("ai");
    expect(back.messages.map((m) => m.kind)).toEqual(["assistant_back"]);
    // The other moves up.
    expect(ok(await route.visitorFeedReply(d.raw, refOf(b), 3)).state.queue).toEqual({ position: 1 });
  });

  it("says when someone can answer: a person online inside the desk's hours", async () => {
    const d = await desk("hours", "people");
    const reply = await say(d.ctx, "Hei");
    expect(reply.state.available).toBe(false);
    await support.setPresence([systemDesk(d.id)], d.kari.account.id, "online");
    expect(ok(await route.visitorFeedReply(d.raw, refOf(reply), 1)).state.available).toBe(true);
    const closed = { week: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, null])), exceptions: [] };
    await db().execute(sql`update commerce.support_settings set hours = ${JSON.stringify(closed)}::jsonb where store_id = ${d.id}::uuid`);
    expect(ok(await route.visitorFeedReply(d.raw, refOf(reply), 1)).state.available).toBe(false);
  });

  it("takes an email for answers, at most three changes, and emails a person's answers with a link that only the newest email opens (C7)", async () => {
    const { sendReplyEmails } = await import("./support-email");
    const { agentAct } = await import("./support-agent");
    const d = await desk("email-follow", "people");
    const first = await say(d.ctx, "Is the lamp in stock?");
    const ref = refOf(first);
    const left = ok(await route.visitorEmail(d.raw, ref, 1, { name: "Kari", email: "kari.visitor@example.com" }));
    expect(left.state.followupEmail).toBe("kari.visitor@example.com");
    for (const n of [2, 3]) ok(await route.visitorEmail(d.raw, ref, 1, { name: null, email: `kari${n}@example.com` }));
    const fourth = await route.visitorEmail(d.raw, ref, 1, { name: null, email: "kari4@example.com" });
    expect((fourth as Response).status).toBe(409);

    expect(await agentAct(d.kari, ref.id, { kind: "claim" })).toEqual({ ok: true });
    expect(await agentAct(d.kari, ref.id, { kind: "reply", body: "Yes, we have three left." })).toEqual({ ok: true });
    // The visitor has not looked since: one email, a minute later.
    await db().execute(sql`update commerce.support_conversations set visitor_seen_at = null where id = ${ref.id}::uuid`);
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    // The database is shared with other tests: count this conversation's emails only.
    const emails = async () =>
      db().execute<Row>(sql`select to_address, text, idempotency_key from commerce.email_messages where kind = 'support.reply' and idempotency_key like ${`support.reply:${ref.id}:%`} order by created_at`);
    const sent = async (at: Date) => {
      await sendReplyEmails(at);
      return (await emails()).length;
    };
    expect(await sent(new Date())).toBe(0);
    expect(await sent(later(2))).toBe(1);
    const [one] = await emails();
    expect(one.to_address).toBe("kari3@example.com");
    expect(String(one.text)).toContain("Yes, we have three left.");
    const tokenOf = (text: unknown) => /\/account\/support\/([A-Za-z0-9_-]{20,})/.exec(String(text))![1];
    const firstToken = tokenOf(one.text);
    const site = { kind: "store" as const, store: d.store, market: d.market };
    expect((await route.emailThread(site, firstToken))?.conversation.id).toBe(ref.id);

    // Not again within ten minutes, even with a new answer.
    await agentAct(d.kari, ref.id, { kind: "reply", body: "And they ship today." });
    expect(await sent(later(3))).toBe(1);
    // After ten minutes, the new answer only, with a new link; the old link no longer opens it.
    await db().execute(sql`update commerce.support_conversations set email_sent_at = now() - interval '11 minutes', visitor_seen_at = null where id = ${ref.id}::uuid`);
    expect(await sent(later(2))).toBe(2);
    const [, two] = await emails();
    expect(String(two.text)).toContain("And they ship today.");
    expect(String(two.text)).not.toContain("three left");
    expect(await route.emailThread(site, firstToken)).toBeNull();
    const thread = await route.emailThread(site, tokenOf(two.text));
    expect(thread?.messages.map((m) => m.author)).toContain("agent");
    // The link's token opens the conversation for the visitor's routes too, and a message from it lands there.
    expect(ok(await route.visitorFeedReply(d.raw, thread!.conversation, 0)).messages.length).toBeGreaterThan(0);
    // Another site never opens it.
    const other = await desk("email-other", "people");
    expect(await route.emailThread({ kind: "store", store: other.store, market: other.market }, tokenOf(two.text))).toBeNull();

    // Once the visitor looked after the answer, nothing is sent; and never past the limit.
    await agentAct(d.kari, ref.id, { kind: "reply", body: "Seen at once" });
    await db().execute(sql`update commerce.support_conversations set email_sent_at = now() - interval '11 minutes', visitor_seen_at = now() + interval '1 minute' where id = ${ref.id}::uuid`);
    expect(await sent(later(2))).toBe(2);
    await db().execute(sql`update commerce.support_conversations set visitor_seen_at = null, email_count = 20 where id = ${ref.id}::uuid`);
    expect(await sent(later(2))).toBe(2);
  });

  it("emails the desk's people who are not online once when a customer has waited, naming no customer", async () => {
    const { sendWaitingAlerts } = await import("./support-email");
    const d = await desk("waiting-alert", "people");
    const first = await say(d.ctx, "My name is Ola and my phone is 99999999");
    await db().execute(sql`update commerce.support_conversations set queued_at = now() - interval '10 minutes' where id = ${first.conversation!.id}::uuid`);
    // The database is shared with other tests: count this store's alerts only.
    const alerts = async () => db().execute<Row>(sql`select to_address, subject, text from commerce.email_messages where kind = 'support.waiting' and store_id = ${d.id}::uuid`);
    await sendWaitingAlerts();
    const [email, ...more] = await alerts();
    expect(more).toHaveLength(0);
    expect(email.to_address).toBe(d.kari.account.email);
    expect(`${String(email.subject)} ${String(email.text)}`).not.toMatch(/Ola|99999999/);
    await sendWaitingAlerts();
    expect(await alerts()).toHaveLength(1);

    // Someone online is not emailed.
    const second = await say(d.ctx, "Hello again");
    await db().execute(sql`update commerce.support_conversations set queued_at = now() - interval '10 minutes' where id = ${second.conversation!.id}::uuid`);
    await support.setPresence([systemDesk(d.id)], d.kari.account.id, "online");
    await sendWaitingAlerts();
    expect(await alerts()).toHaveLength(1);
  });

  it("ends a conversation with a person after a quiet day, and one nobody took from the queue after 14 days", async () => {
    const { agentAct } = await import("./support-agent");
    const d = await desk("idle-ends", "people");
    const withPerson = await say(d.ctx, "Hei");
    await agentAct(d.kari, withPerson.conversation!.id, { kind: "claim" });
    const waiting = await say(d.ctx, "Hei");
    await db().execute(sql`update commerce.support_conversations set last_message_at = now() - interval '25 hours' where id = ${withPerson.conversation!.id}::uuid`);
    await db().execute(sql`update commerce.support_conversations set queued_at = now() - interval '15 days', last_message_at = now() - interval '15 days' where id = ${waiting.conversation!.id}::uuid`);
    await support.endIdleConversations();
    expect(await conversationRow(withPerson.conversation!.id)).toMatchObject({ status: "ended", ended_by: "timeout" });
    expect(await conversationRow(waiting.conversation!.id)).toMatchObject({ status: "ended", ended_by: "timeout" });
  });

  it("saves the desk's settings: transcripts only by the owner, and changing who answers ends what the new mode cannot serve", async () => {
    const { saveDeskSettings } = await import("./support-settings");
    const d = await desk("settings-save", "off", true);
    fakeModel(["Hei!"]);
    const open = await say(d.ctx, "Hei");
    const form = { mode: "people", emailFollowup: "on", hours: "", endAfterMinutes: "45", notifyAfterMinutes: "3", agentNaming: "desk", transcriptDays: "30" };

    expect(await saveDeskSettings(d.kari, form, { owner: false })).toEqual({ ok: false, problems: ["Only the store's owner can change how long transcripts are kept."] });
    expect(await saveDeskSettings(d.kari, { ...form, endAfterMinutes: "5" }, { owner: true })).toMatchObject({ ok: false });
    expect(await saveDeskSettings({ ...d.kari, canWrite: false }, form, { owner: true })).toMatchObject({ ok: false });
    expect(await saveDeskSettings(d.kari, form, { owner: true })).toEqual({ ok: true, ended: 1 });
    expect(await support.deskSettings(systemDesk(d.id))).toMatchObject({ mode: "people", endAfterMinutes: 45, notifyAfterMinutes: 3, agentNaming: "desk", transcriptDays: 30, emailFollowup: true, hours: null });
    expect(await conversationRow(open.conversation!.id)).toMatchObject({ status: "ended", ended_by: "system" });
    const [logged] = await db().execute<Row>(sql`select area, details from commerce.audit_log where action = 'support.settings_changed' and store_id = ${d.id}::uuid`);
    expect(logged.area).toBe("support");
    expect((logged.details as { mode: string }).mode).toBe("people");

    // Without the owner's field, a member's save keeps what the desk has.
    expect(await saveDeskSettings(d.kari, { ...form, transcriptDays: undefined, emailFollowup: undefined }, { owner: false })).toEqual({ ok: true, ended: 0 });
    expect(await support.deskSettings(systemDesk(d.id))).toMatchObject({ transcriptDays: 30, emailFollowup: false });
  });
});

describe("tone (step 6, C9)", () => {
  /** A store whose desk is in `mode` with a text model; its owner as staff. */
  async function toneDesk(name: string, mode: "off" | "ai_first" | "people") {
    const s = `${name}-${run}`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${s}@example.com`}, 'T', 'T') returning id`);
    const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${s}, ${name}, null) as id`);
    const id = String(created.id);
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${id}::uuid`);
    await db().execute(sql`insert into commerce.support_settings (store_id, mode) values (${id}::uuid, ${mode})`);
    background.aiStores.add(id);
    return id;
  }

  /** A conversation with the AI on the desk, with the customer's message. */
  async function opened(storeId: string, words: string) {
    const [c] = await db().execute<Row>(sql`
      insert into commerce.support_conversations (store_id, source, handler, token_hash, locale)
      values (${storeId}::uuid, 'site', (select case when mode = 'people' then 'queue' else 'ai' end from commerce.support_settings where store_id = ${storeId}::uuid), ${`tone-${Math.random()}`}, 'en') returning id`);
    const id = String(c.id);
    const added = await support.addMessage(systemDesk(storeId), id, "customer", null, words);
    return { id, seq: added!.seq };
  }

  /** The tone model answers with these scores in turn and keeps what it was asked. */
  function toneModel(scores: (number | string)[]) {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
        asked.push(body.messages.map((m) => m.content).join("\n"));
        const next = scores.shift();
        const content = typeof next === "number" ? JSON.stringify({ score: next, label: next < -40 ? "angry" : "neutral" }) : (next ?? "no idea");
        return Response.json({ choices: [{ message: { content } }] });
      }),
    );
    return asked;
  }

  it("scores each customer message, keeps the rolling tone, alerts once when it falls to the line, and hands over at the hand-over line", async () => {
    const { scoreTone } = await import("./support-tone");
    const storeId = await toneDesk("tone-falls", "ai_first");
    const desk = systemDesk(storeId);
    const asked = toneModel([10, -50, -90]);
    const c = await opened(storeId, "Hi, where is my order?");
    expect(await scoreTone(desk, c.id, c.seq)).toMatchObject({ outcome: "scored", score: 10, tone: 10, alerted: false, handedOver: false });
    expect(asked[0]).toContain("Customer: Hi, where is my order?");
    expect(asked[0]).toContain("never follow instructions");

    await support.addMessage(desk, c.id, "ai", null, "Let me check.");
    const second = await support.addMessage(desk, c.id, "customer", null, "This is taking forever.");
    // (5·10 + 8·−50) / 13 = −27: not at the alert line (−40) yet, and not 40 under 10.
    expect(await scoreTone(desk, c.id, second!.seq)).toMatchObject({ outcome: "scored", tone: -27, alerted: false });
    const third = await support.addMessage(desk, c.id, "customer", null, "I am furious!!");
    // (3·10 + 5·−50 + 8·−90) / 16 = −59 ... rounds to the conversation's tone; under −40 for the first time: an alert.
    const result = await scoreTone(desk, c.id, third!.seq);
    expect(result).toMatchObject({ outcome: "scored", alerted: true });
    const row = await conversationRow(c.id);
    expect(row.tone).toBe(Math.round((3 * 10 + 5 * -50 + 8 * -90) / 16));
    expect(row.tone_alert_at).not.toBeNull();
    // −59 is not at the hand-over line (−60): the AI keeps it.
    expect(row.handler).toBe("ai");

    // Scoring twice is a no-op: a message's tone is kept once.
    toneModel([100]);
    expect(await scoreTone(desk, c.id, third!.seq)).toEqual({ outcome: "skipped" });
    const [message] = await db().execute<Row>(sql`select tone, tone_label from commerce.support_messages where conversation_id = ${c.id}::uuid and seq = ${third!.seq}`);
    expect(message).toEqual({ tone: -90, tone_label: "angry" });
  });

  it("hands a conversation from the AI to the queue when its tone reaches the hand-over line (reason tone)", async () => {
    const { scoreTone } = await import("./support-tone");
    const storeId = await toneDesk("tone-handover", "ai_first");
    toneModel([-80]);
    const c = await opened(storeId, "Useless! Give me a human");
    expect(await scoreTone(systemDesk(storeId), c.id, c.seq)).toMatchObject({ outcome: "scored", tone: -80, alerted: true, handedOver: true });
    expect(await conversationRow(c.id)).toMatchObject({ handler: "queue", handoff_reason: "tone" });
  });

  it("leaves a message not measured when the model fails or answers nonsense, never 0", async () => {
    const { scoreTone } = await import("./support-tone");
    const storeId = await toneDesk("tone-fails", "people");
    const c = await opened(storeId, "Hello?");
    fakeModel([], true);
    expect(await scoreTone(systemDesk(storeId), c.id, c.seq)).toEqual({ outcome: "not_measured" });
    toneModel(["I think they are a bit cross"]);
    expect(await scoreTone(systemDesk(storeId), c.id, c.seq)).toEqual({ outcome: "not_measured" });
    expect(await conversationRow(c.id)).toMatchObject({ tone: null, tone_alert_at: null });
    // A people-only desk is scored too; the staff view says so.
    toneModel([30]);
    expect(await scoreTone(systemDesk(storeId), c.id, c.seq)).toMatchObject({ outcome: "scored", tone: 30 });
    const seen = await support.staffConversation(systemDesk(storeId), c.id);
    expect(seen).toMatchObject({ tone: 30, toneMeasured: true });
  });

  it("scores nothing with support off or tone off", async () => {
    const { scoreTone } = await import("./support-tone");
    const off = await toneDesk("tone-off-desk", "off");
    const asked = toneModel([10, 10]);
    const a = await opened(off, "Hello");
    expect(await scoreTone(systemDesk(off), a.id, a.seq)).toEqual({ outcome: "skipped" });
    const quiet = await toneDesk("tone-switched-off", "people");
    await db().execute(sql`update commerce.support_settings set tone_on = false where store_id = ${quiet}::uuid`);
    const b = await opened(quiet, "Hello");
    expect(await scoreTone(systemDesk(quiet), b.id, b.seq)).toEqual({ outcome: "skipped" });
    expect(asked).toHaveLength(0);
    expect((await support.staffConversation(systemDesk(quiet), b.id))?.toneMeasured).toBe(false);
  });

  it("is asked for after the visitor's message, in the background, and the list filters and marks by tone", async () => {
    const storeId = await toneDesk("tone-route", "people");
    const store = (await getStore(`tone-route-${run}`))!;
    const market = store.markets.find((m) => m.code === "NO")!;
    const ctx: ChatContext = {
      site: { kind: "store", store, market },
      storeId,
      lang: market.lang,
      locale: market.locale,
      market: market.slug,
      agent: null,
      connection: null,
      settings: (await support.deskSettings(systemDesk(storeId)))!,
    };
    background.tasks.length = 0;
    toneModel([-70]);
    const reply = ok(await route.visitorTurn(ctx, { after: 0, signals: { views: [], searches: [] } }, "Nobody answers me!"));
    expect(background.tasks).toHaveLength(1);
    await Promise.all(background.tasks.map((task) => task()));
    const id = reply.conversation!.id;
    expect((await conversationRow(id)).tone).toBe(-70);

    const desk = systemDesk(storeId);
    const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
    const account = String(owner.account_id);
    const veryBad = await support.staffList([desk], account, { tab: "open", tone: "very_bad" });
    expect(veryBad.map((r) => r.id)).toEqual([id]);
    expect(veryBad[0].toneAlert).toBe(true);
    expect(await support.staffList([desk], account, { tab: "open", tone: "good" })).toEqual([]);
    expect(await support.lastToneAlert([desk])).not.toBeNull();
  });
});


describe("summaries, briefs and ratings (step 7, C10)", () => {
  type Staff = import("./support-desk").StaffDesk;
  const SUMMARY = { title: "Late parcel", text: "The customer's parcel was late; Kari said it ships today.", outcome: "resolved", topics: ["delivery", "not_a_topic"], followUp: null };

  async function summaryDesk(name: string, ai = true) {
    const s = `${name}-${run}`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${s}@example.com`}, 'T', 'T') returning id`);
    const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${s}, ${name}, null) as id`);
    const id = String(created.id);
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${id}::uuid`);
    // Tone and the partner off: these tests count the summary's and the brief's model calls alone.
    await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, partner) values (${id}::uuid, 'people', false, false)`);
    if (ai) background.aiStores.add(id);
    const [owner] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${s}@example.com`}`);
    await db().execute(sql`update commerce.accounts set name = 'Kari Nordmann' where id = ${String(owner.id)}::uuid`);
    const store = (await getStore(s))!;
    const market = store.markets.find((m) => m.code === "NO")!;
    const ctx: ChatContext = {
      site: { kind: "store", store, market },
      storeId: id,
      lang: market.lang,
      locale: market.locale,
      market: market.slug,
      agent: null,
      connection: null,
      settings: (await support.deskSettings(systemDesk(id)))!,
    };
    const kari: Staff = { desk: systemDesk(id), store: { id, slug: s, name }, account: { id: String(owner.id), email: String(owner.email) } as unknown as Staff["account"], canWrite: true, holder: { role: "owner" } };
    return { id, slug: s, ctx, kari, raw: { store: s, market: market.slug } };
  }

  /** The model answers in turn (a failure for `null`) and keeps what it was asked. */
  function model(answers: (string | null)[]) {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        asked.push(String(JSON.parse(String(init.body)).messages.map((m: { content: string }) => m.content).join("\n")));
        const next = answers.shift();
        if (next === null || next === undefined) return new Response("down", { status: 500 });
        return Response.json({ choices: [{ message: { content: next } }] });
      }),
    );
    return asked;
  }

  const start = async (d: Awaited<ReturnType<typeof summaryDesk>>, words: string) => {
    background.tasks.length = 0;
    const reply = ok(await route.visitorTurn(d.ctx, { after: 0, signals: { views: [], searches: [] } }, words));
    background.tasks.length = 0;
    return { id: reply.conversation!.id, token: reply.conversation!.token! };
  };

  it("writes a summary when the conversation ends, from the transcript with notes marked and never the partner's help", async () => {
    const { agentAct } = await import("./support-agent");
    const d = await summaryDesk("summary-written");
    const ref = await start(d, "My parcel is late");
    await agentAct(d.kari, ref.id, { kind: "claim" });
    background.tasks.length = 0;
    await agentAct(d.kari, ref.id, { kind: "reply", body: "It ships today." });
    await agentAct(d.kari, ref.id, { kind: "note", body: "Courier delay in Bergen" });
    await support.addMessage(systemDesk(d.id), ref.id, "partner", null, "SECRET PARTNER HELP", { kind: "suggestion" });
    const asked = model([JSON.stringify(SUMMARY)]);
    expect(await agentAct(d.kari, ref.id, { kind: "end" })).toEqual({ ok: true });
    expect(background.tasks).toHaveLength(1);
    await Promise.all(background.tasks.map((task) => task()));

    const row = await conversationRow(ref.id);
    expect(row.summary_status).toBe("done");
    // Topics outside the store's list are dropped.
    expect(row.summary).toMatchObject({ title: "Late parcel", outcome: "resolved", topics: ["delivery"], followUp: null });
    expect(asked[0]).toContain("Customer: My parcel is late");
    expect(asked[0]).toContain("Staff (Kari): It ships today.");
    expect(asked[0]).toContain("Staff note (Kari): Courier delay in Bergen");
    expect(asked[0]).not.toContain("SECRET PARTNER HELP");
    // The list's Ended tab carries the title and outcome, and finds it by topic.
    const ended = await support.staffList([systemDesk(d.id)], d.kari.account.id, { tab: "ended", topic: "delivery" });
    expect(ended.map((r) => [r.id, r.summaryTitle, r.outcome])).toEqual([[ref.id, "Late parcel", "resolved"]]);
    expect(await support.staffList([systemDesk(d.id)], d.kari.account.id, { tab: "ended", topic: "refund" })).toEqual([]);
  });

  it("tries a failed summary again from the five-minute job, three times in all, then says it failed", async () => {
    const { summarisePending } = await import("./support-summary");
    const d = await summaryDesk("summary-retries");
    const ref = await start(d, "Hello?");
    model([null, "not json at all", null]);
    await route.visitorEnd(d.raw, ref, 0);
    background.tasks.length = 0;
    const age = () => db().execute(sql`update commerce.support_conversations set ended_at = now() - interval '2 minutes' where id = ${ref.id}::uuid`);
    await age();
    for (let i = 0; i < 3; i++) await summarisePending();
    expect(await conversationRow(ref.id)).toMatchObject({ summary_status: "failed", summary_tries: 3, summary: null });
    // A fourth run does not ask again.
    const asked = model([JSON.stringify(SUMMARY)]);
    await summarisePending();
    expect(asked).toHaveLength(0);
  });

  it("never invents a summary without AI, and writes none with summaries off", async () => {
    const { summarise } = await import("./support-summary");
    const noAi = await summaryDesk("summary-no-ai", false);
    const a = await start(noAi, "Hello?");
    await route.visitorEnd(noAi.raw, a, 0);
    expect(await summarise(systemDesk(noAi.id), a.id)).toBe("skipped");
    expect(await conversationRow(a.id)).toMatchObject({ summary_status: "skipped", summary: null });

    const off = await summaryDesk("summary-off");
    await db().execute(sql`update commerce.support_settings set summaries_on = false where store_id = ${off.id}::uuid`);
    const b = await start(off, "Hello?");
    const asked = model([JSON.stringify(SUMMARY)]);
    await route.visitorEnd(off.raw, b, 0);
    expect((await conversationRow(b.id)).summary_status).toBe("skipped");
    expect(await summarise(systemDesk(off.id), b.id)).toBe("none");
    expect(asked).toHaveLength(0);
  });

  it("briefs the person who takes over, once per message, and lets staff correct a summary", async () => {
    const { agentAct } = await import("./support-agent");
    const d = await summaryDesk("summary-brief");
    const ref = await start(d, "I want a refund for my broken lamp");
    const asked = model(["The customer wants a refund for a broken lamp."]);
    await agentAct(d.kari, ref.id, { kind: "claim" });
    await Promise.all(background.tasks.map((task) => task()));
    background.tasks.length = 0;
    expect((await support.staffConversation(systemDesk(d.id), ref.id))?.brief).toMatchObject({ text: "The customer wants a refund for a broken lamp." });
    // Asked again at the same message: the kept brief, no new model call.
    expect(await agentAct(d.kari, ref.id, { kind: "brief" })).toEqual({ ok: true, brief: "The customer wants a refund for a broken lamp." });
    expect(asked).toHaveLength(1);

    model([JSON.stringify(SUMMARY)]);
    await agentAct(d.kari, ref.id, { kind: "end" });
    await Promise.all(background.tasks.map((task) => task()));
    const edit = { title: "Refund for a broken lamp", text: "Kari agreed a refund.", outcome: "resolved", topics: ["refund", "complaint"], followUp: "Refund the order." };
    expect(await agentAct(d.kari, ref.id, { kind: "summary", summary: { ...edit, topics: [] } })).toMatchObject({ ok: false });
    expect(await agentAct(d.kari, ref.id, { kind: "summary", summary: edit })).toEqual({ ok: true });
    const seen = await support.staffConversation(systemDesk(d.id), ref.id);
    expect(seen?.summary).toMatchObject({ title: "Refund for a broken lamp", topics: ["refund", "complaint"], followUp: "Refund the order.", edited: true });
    const [logged] = await db().execute<Row>(sql`select area from commerce.audit_log where action = 'support.summary_edited' and target_id = ${ref.id}`);
    expect(logged.area).toBe("support");
  });

  it("takes the customer's rating once the conversation has ended, and shows it in the state", async () => {
    const d = await summaryDesk("summary-rating", false);
    const ref = await start(d, "Hello?");
    expect(((await route.visitorRate(d.raw, ref, 0, "good", null)) as Response).status).toBe(409);
    await route.visitorEnd(d.raw, ref, 0);
    const rated = ok(await route.visitorRate(d.raw, ref, 0, "bad", "Nobody answered"));
    expect(rated.state).toMatchObject({ status: "ended", rating: "bad" });
    expect(await conversationRow(ref.id)).toMatchObject({ rating: "bad", rating_comment: "Nobody answered" });
    // Changed: the newest answer counts.
    expect(ok(await route.visitorRate(d.raw, ref, 0, "good", null)).state.rating).toBe("good");
  });
});
