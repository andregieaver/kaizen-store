import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
const background = vi.hoisted(() => ({ tasks: [] as (() => unknown)[], aiStores: new Set<string>() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => background.tasks.push(task),
}));
// Stores in `aiStores` have a text model; the assistant is a saved row, and the turn itself is a stand-in.
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

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const inbound = await import("./support-inbound");
const { EMAIL_RETRY_MINUTES, EMAIL_TRIES, sendReplyEmails } = await import("./support-email");
const support = await import("./support");
const { systemDesk } = await import("./support-desk");
type InboundDeps = import("./support-inbound").InboundDeps;
type ReceivedEmail = import("./support-inbound").ReceivedEmail;

type Row = Record<string, unknown>;

/**
 * Email into the support desk (D332, `docs/support.md` step 16), with Resend and the AI's turn as stand-ins: an email to the desk's
 * address starts a conversation by email (people only: it waits in the queue; the AI first: the AI answers with the email channel),
 * a reply from the same address continues it and one from another address does not, machines and failing DMARC are refused, an email
 * Resend sends twice is taken once, the sender's limit holds, nothing is taken while support is off, and the answers go back as a
 * reply in the customer's thread, the AI's marked as the AI's.
 */

const DOMAIN = "in.example.com";
const env = { SUPPORT_INBOUND_DOMAIN: DOMAIN, RESEND_API_KEY: "re_test" };
let store: Awaited<ReturnType<typeof makeStore>>;
let deskAddress: string;
const emails = new Map<string, ReceivedEmail>();
const turns: { email?: boolean; customer: unknown }[] = [];

/** Resend refusing our key (a sending-only key) while true. */
let keyRefused = false;
const fakeFetch = (async (url: string) => {
  if (keyRefused) return new Response('{"name":"restricted_api_key"}', { status: 401 });
  const id = decodeURIComponent(String(url).split("/").pop() ?? "");
  const email = emails.get(id);
  return email ? Response.json(email) : new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

const fakeTurn: NonNullable<InboundDeps["turn"]> = async (desk, _context, conversationId, _input, customer, _admin, channel) => {
  turns.push({ email: channel?.email, customer });
  await support.addMessage(desk, conversationId, "ai", null, "Your parcel is on its way.");
  return { reply: null };
};

const deps: InboundDeps = { fetch: fakeFetch, turn: fakeTurn, env };
let counter = 0;

/** Resend's event and the email behind it; the event goes through the webhook's receiver, then the work it left for after. */
async function receive(to: string, from: string, email: Partial<ReceivedEmail> = {}, id = `em_${Date.now()}_${++counter}`) {
  emails.set(id, { from, subject: "Where is my parcel?", text: "Hello, order 1001 has not come.", headers: {}, message_id: `<${id}@mail.example.com>`, ...email });
  const result = await inbound.receiveInboundEvent({ type: "email.received", data: { email_id: id, from, to: [to], subject: email.subject ?? "Where is my parcel?", message_id: `<${id}@mail.example.com>` } }, deps);
  const tasks = background.tasks.splice(0);
  for (const task of tasks) await task();
  const [row] = await db().execute<Row>(sql`select * from commerce.support_inbound_emails where provider_id = ${id}`);
  return { result, row };
}

const conversation = async (id: unknown) => (await db().execute<Row>(sql`select * from commerce.support_conversations where id = ${String(id)}::uuid`))[0];
const messages = async (id: unknown) => db().execute<Row>(sql`select author, body, data from commerce.support_messages where conversation_id = ${String(id)}::uuid and author <> 'system' order by seq`);
const setMode = (mode: string) => db().execute(sql`update commerce.support_settings set mode = ${mode} where store_id = ${store.id}::uuid`);

beforeAll(async () => {
  vi.stubEnv("SUPPORT_INBOUND_DOMAIN", DOMAIN);
  store = await makeStore("support-inbound");
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.id}::uuid`);
  await support.ensureDesk(systemDesk(store.id));
  await db().execute(sql`update commerce.support_settings set mode = 'people', tone_on = false, summaries_on = false where store_id = ${store.id}::uuid`);
  deskAddress = (await inbound.deskEmailAddress(systemDesk(store.id), env))!;
});

beforeEach(() => {
  turns.length = 0;
  background.aiStores.clear();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db().execute(sql`delete from commerce.support_inbound_emails where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("email into the desk", () => {
  it("gives each desk one address at the receiving domain, and none while receiving is not set up", async () => {
    expect(deskAddress).toMatch(new RegExp(`^desk-[a-z0-9]{12,32}@${DOMAIN.replace(/\./g, "\\.")}$`));
    expect(await inbound.deskEmailAddress(systemDesk(store.id), env)).toBe(deskAddress);
    expect(await inbound.deskEmailAddress(systemDesk(store.id), {})).toBeNull();
  });

  it("starts a conversation by email in the queue with people only, the subject first and the sender as its contact", async () => {
    const { row } = await receive(deskAddress, '"Kari Nordmann" <Kari@Example.com>', { attachments: [{}, {}] });
    expect(row).toMatchObject({ status: "done", routed: true, from_address: "kari@example.com", subject: "Where is my parcel?" });
    const c = await conversation(row.conversation_id);
    expect(c).toMatchObject({ source: "email", handler: "queue", contact_email: "kari@example.com", contact_name: "Kari Nordmann", customer_id: null, email_subject: "Where is my parcel?" });
    expect(String(c.reply_key)).toMatch(/^[a-z0-9]{12,32}$/);
    const said = await messages(row.conversation_id);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ author: "customer", body: "Where is my parcel?\n\nHello, order 1001 has not come." });
    expect(said[0].data).toMatchObject({ email: { attachments: 2, cut: false } });
    expect(turns).toHaveLength(0);
  });

  it("continues the conversation from its own address, and starts another for anyone else writing to its reply address", async () => {
    const first = await receive(deskAddress, "ola@example.com");
    const c = await conversation(first.row.conversation_id);
    const reply = `reply-${String(c.reply_key)}@${DOMAIN}`;
    const again = await receive(reply, "Ola <ola@example.com>", { subject: "Re: Where is my parcel?", text: "Any news?\n\nOn Mon, 3 Mar 2026 at 10:00, Shop <x@y.no> wrote:\n> old" });
    expect(again.row.conversation_id).toBe(first.row.conversation_id);
    expect((await messages(c.id)).map((m) => m.body)).toEqual(["Where is my parcel?\n\nHello, order 1001 has not come.", "Any news?"]);
    expect(await conversation(c.id)).toMatchObject({ email_message_id: `<${String(again.row.provider_id)}@mail.example.com>` });

    const stranger = await receive(reply, "mallory@example.com");
    expect(stranger.row.status).toBe("done");
    expect(stranger.row.conversation_id).not.toBe(first.row.conversation_id);
    expect(await messages(c.id)).toHaveLength(2);
  });

  it("refuses machines and failing DMARC, and takes an email Resend sends twice once", async () => {
    expect((await receive(deskAddress, "kari@example.com", { headers: { "Auto-Submitted": "auto-replied" } })).row).toMatchObject({ status: "refused", reason: "auto_submitted" });
    expect((await receive(deskAddress, "kari@example.com", { authentication: { dmarc: "fail" } })).row).toMatchObject({ status: "refused", reason: "dmarc_fail" });
    expect((await receive(`desk-unknownkey000@${DOMAIN}`, "kari@example.com")).row).toMatchObject({ status: "refused", reason: "unknown_address", routed: false });
    const once = await receive(deskAddress, "per@example.com", {}, "em_twice");
    expect(once.row.status).toBe("done");
    expect((await receive(deskAddress, "per@example.com", {}, "em_twice")).result.status).toBe("duplicate");
  });

  it("holds one sender to the hour's limit", async () => {
    await db().execute(sql`
      insert into commerce.support_inbound_emails (provider_id, store_id, routed, from_address, status, received_at)
      select 'limit_' || g || '_' || ${String(Date.now())}, ${store.id}::uuid, true, 'busy@example.com', 'done', now() from generate_series(1, 10) g
    `);
    expect((await receive(deskAddress, "busy@example.com")).row).toMatchObject({ status: "refused", reason: "sender_limit" });
  });

  it("lets the AI answer first by email, with no customer, and sends its answer back as a reply in the thread", async () => {
    await setMode("ai_first");
    background.aiStores.add(store.id);
    await db().execute(sql`insert into commerce.chat_agents (store_id, enabled, name) values (${store.id}::uuid, true, 'Ingrid')`);
    const { row } = await receive(deskAddress, "lise@example.com", { subject: "Parcel" });
    expect(turns).toEqual([{ email: true, customer: null }]);
    const c = await conversation(row.conversation_id);
    expect(c).toMatchObject({ handler: "ai", status: "open" });

    // Not yet: the answer settles first.
    await sendReplyEmails(new Date());
    expect(await answerEmails(c.id)).toHaveLength(0);
    await sendReplyEmails(new Date(Date.now() + 60_000));
    const sent = await answerEmails(c.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to_address: "lise@example.com", subject: "Re: Parcel" });
    expect(String(sent[0].text)).toContain("Your parcel is on its way.");
    // The AI's answer is marked as the AI's (AI Act Art. 50), as the chat's notice says.
    expect(String(sent[0].text)).toContain("Svar fra KI:");
    expect(String(sent[0].text)).toContain("skrevet av kunstig intelligens");
    await sendReplyEmails(new Date(Date.now() + 120_000));
    expect(await answerEmails(c.id)).toHaveLength(1);
  });

  it("tries a refused answer email again, with a key of its own, and stops after the last try", async () => {
    await setMode("ai_first");
    background.aiStores.add(store.id);
    await db().execute(sql`insert into commerce.chat_agents (store_id, enabled, name) values (${store.id}::uuid, true, 'Ingrid') on conflict do nothing`);
    const answered = async (to: string, subject?: string) => (await receive(deskAddress, to, subject ? { subject } : {})).row;
    const row = await answered("olav@example.com", "Again");
    let refuse = true;
    const sends: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sends.push(String((init.headers as Record<string, string>)["Idempotency-Key"]));
      return refuse ? Response.json({ name: "validation_error", message: "domain not verified" }, { status: 403 }) : Response.json({ id: "re_sent" });
    });
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "support@example.com");
    try {
      const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);
      await sendReplyEmails(at(1));
      await sendReplyEmails(at(2));
      // Refused once; not again until EMAIL_RETRY_MINUTES have passed, and never counted as told.
      expect(sends).toHaveLength(1);
      expect(await conversation(row.conversation_id)).toMatchObject({ email_count: 0 });
      refuse = false;
      await sendReplyEmails(at(1 + EMAIL_RETRY_MINUTES));
      expect(sends).toHaveLength(2);
      const kept = await db().execute<Row>(sql`
        select idempotency_key, status from commerce.email_messages where idempotency_key like ${`support.reply:${String(row.conversation_id)}:%`} order by created_at
      `);
      expect(kept.map((r) => r.status)).toEqual(["failed", "sent"]);
      expect(String(kept[1].idempotency_key)).toMatch(/:retry1$/);
      expect(await conversation(row.conversation_id)).toMatchObject({ email_count: 1 });
      await sendReplyEmails(at(2 + 2 * EMAIL_RETRY_MINUTES));
      expect(sends).toHaveLength(2);

      // An answer refused every time stops after EMAIL_TRIES.
      refuse = true;
      const other = { row: await answered("siri@example.com") };
      for (let i = 1; i <= EMAIL_TRIES + 2; i++) await sendReplyEmails(at(i * (EMAIL_RETRY_MINUTES + 1)));
      const tries = await db().execute<Row>(sql`select 1 from commerce.email_messages where idempotency_key like ${`support.reply:${String(other.row.conversation_id)}:%`}`);
      expect(tries).toHaveLength(EMAIL_TRIES);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("hands the conversation to a person when the AI first has no assistant", async () => {
    await setMode("ai_first");
    await db().execute(sql`delete from commerce.chat_agents where store_id = ${store.id}::uuid`);
    const { row } = await receive(deskAddress, "nils@example.com");
    expect(turns).toHaveLength(0);
    expect(await conversation(row.conversation_id)).toMatchObject({ handler: "queue", handoff_reason: "no_ai" });
  });

  it("takes nothing while support is off", async () => {
    await setMode("off");
    expect((await receive(deskAddress, "kari@example.com")).row).toMatchObject({ status: "refused", reason: "desk_off" });
    await setMode("people");
  });

  it("keeps an email Resend refuses to give with our key, says so on the desk, and reads it once the key works", async () => {
    keyRefused = true;
    const { row } = await receive(deskAddress, "keyless@example.com");
    expect(row).toMatchObject({ status: "failed", reason: "key_refused", tries: 0 });
    expect(await inbound.deskEmailsKeyRefused(systemDesk(store.id))).toBe(1);

    // Not again at once: the next run leaves it alone.
    await inbound.processInboundEmails(deps);
    expect((await db().execute<Row>(sql`select status from commerce.support_inbound_emails where id = ${String(row.id)}::uuid`))[0].status).toBe("failed");

    // The key is fixed; half an hour on, it is read.
    keyRefused = false;
    await db().execute(sql`update commerce.support_inbound_emails set finished_at = now() - interval '31 minutes' where id = ${String(row.id)}::uuid`);
    await inbound.processInboundEmails(deps);
    const [after] = await db().execute<Row>(sql`select status, conversation_id from commerce.support_inbound_emails where id = ${String(row.id)}::uuid`);
    expect(after.status).toBe("done");
    expect(after.conversation_id).toBeTruthy();
    expect(await inbound.deskEmailsKeyRefused(systemDesk(store.id))).toBe(0);
  });

  it("clears a conversation's email fields when it is anonymised", async () => {
    const { row } = await receive(deskAddress, "erase@example.com");
    await support.anonymiseConversations(db(), [String(row.conversation_id)]);
    expect(await conversation(row.conversation_id)).toMatchObject({ contact_email: null, reply_key: null, email_subject: null, email_message_id: null });
    expect(await messages(row.conversation_id)).toHaveLength(0);
  });
});

const answerEmails = async (conversationId: unknown) =>
  db().execute<Row>(sql`select to_address, subject, text from commerce.email_messages where kind = 'support.reply' and idempotency_key like ${`support.reply:${String(conversationId)}:%`}`);
