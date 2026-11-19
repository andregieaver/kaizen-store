import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, pageInput } from "@/lib/page-content";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
// The AI's answer runs after the form's response (D797): kept here and run by the test. The store has a text model while `ai.on`.
const background = vi.hoisted(() => ({ tasks: [] as (() => unknown)[], on: false }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => background.tasks.push(task),
}));
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  return {
    ...real,
    aiFor: async (storeId: string | null, ...rest: unknown[]) =>
      background.on
        ? ({ provider: "openai", source: "store", apiUrl: "https://ai.example.com/v1", apiKey: "sk-test", textModel: "text-model", embeddingModel: null, space: null } as never)
        : (real.aiFor as (...args: unknown[]) => unknown)(storeId, ...rest),
  };
});

// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

const forms = await import("./forms");
const { formMessageParts, formToInbox } = await import("./support-forms");
const support = await import("./support");
const { systemDesk } = await import("./support-desk");
const { sendReplyEmails } = await import("./support-email");
const { emailCustomer } = await import("./support-inbound");
type Turn = NonNullable<import("./support-inbound").InboundDeps["turn"]>;

type Row = Record<string, unknown>;

/**
 * A store's contact form's message in its support inbox (wave 11 unit C, D382): a conversation of source `form` in the queue while the
 * desk is on (people only, also with the AI first: the database never lets it go to the AI, and its summary is skipped), the form's
 * recipients emailed too unless the owner chose the inbox alone, nothing in the inbox while support is off, a person's answer emailed
 * to the address the form gave, and a customer with that address shown, never tied.
 */

const run = Date.now().toString(36);
const block = `contact-${run}`;
const path = "/s/forms/no/kontakt";
let storeId: string;
let owner: string;

const page = pageInput.parse({
  ...newPageContent(),
  title: "Kontakt",
  slug: "kontakt",
  rows: [
    {
      id: "r1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "c1",
          blocks: [
            {
              id: block,
              type: "emailForm",
              recipients: [`post-${run}@example.com`],
              subject: "",
              fields: [
                { id: "name", kind: "name", label: "", required: true },
                { id: "mail", kind: "email", label: "", required: false },
                { id: "msg", kind: "textarea", label: "", required: true },
              ],
              submitLabel: "",
              successMessage: "",
            },
          ],
        },
      ],
    },
  ],
});

let visitors = 0;
const send = (values: Record<string, string>) =>
  forms.submitForm(
    { store: storeId, block, values, consent: true, website: "", lang: "nb", path, elapsed: 8000 } as Parameters<typeof forms.submitForm>[0],
    `visitor-${run}-${++visitors}`,
  );

const setDesk = (mode: string, formMessages = "inbox_and_email") =>
  db().execute(sql`update commerce.support_settings set mode = ${mode}, form_messages = ${formMessages} where store_id = ${storeId}::uuid`);

const latest = async () =>
  (await db().execute<Row>(sql`select * from commerce.support_conversations where store_id = ${storeId}::uuid and source = 'form' order by created_at desc limit 1`))[0];
const formConversations = async () =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.support_conversations where store_id = ${storeId}::uuid and source = 'form'`))[0].n);
const recipientEmails = async () =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where to_address = ${`post-${run}@example.com`}`))[0].n);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`support-forms-${run}@example.com`}, 'Kari', 'Skjema') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`support-forms-${run}`}, 'Skjema', null) as id`);
  storeId = String(store.id);
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(m.account_id);
  await db().execute(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at)
    values (${storeId}::uuid, 'page', 'kontakt', ${JSON.stringify(page)}::jsonb, ${JSON.stringify(page)}::jsonb, now())
  `);
  await support.ensureDesk(systemDesk(storeId));
}, 120_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.form_submissions where store_id = ${storeId}::uuid`);
  await closeDb();
});

describe("contact form messages in the support inbox (D382)", () => {
  it("puts nothing in the inbox while support is off: the recipients are emailed as before", async () => {
    await setDesk("off");
    const before = await recipientEmails();
    expect(await send({ name: "Ola", mail: `ola-${run}@example.com`, msg: "Hei" })).toEqual({ status: 200, body: { ok: true, outcome: "sent" } });
    expect(await formConversations()).toBe(0);
    expect(await recipientEmails()).toBe(before + 1);
  });

  it("starts a conversation in the queue with the form's address and name, and emails the recipients too by default", async () => {
    await setDesk("people");
    const before = await recipientEmails();
    expect(await send({ name: "Kari  Nordmann", mail: `Kari-${run}@Example.com`, msg: "Har dere gavekort?" })).toMatchObject({ status: 200 });
    const c = await latest();
    expect(c).toMatchObject({
      source: "form",
      status: "open",
      handler: "queue",
      customer_id: null,
      contact_email: `kari-${run}@example.com`,
      contact_name: "Kari Nordmann",
      email_subject: "Ny melding fra Skjema",
      page_path: path,
      market: "no",
    });
    const messages = await db().execute<Row>(sql`select author, body, data from commerce.support_messages where conversation_id = ${String(c.id)}::uuid order by seq`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ author: "customer", data: { form: { block, path, cut: false } } });
    expect(String(messages[0].body)).toContain("Har dere gavekort?");
    expect(await recipientEmails()).toBe(before + 1);
  });

  it("emails nobody when the owner chose the inbox alone", async () => {
    await setDesk("people", "inbox");
    const before = await recipientEmails();
    expect(await send({ name: "Per", mail: `per-${run}@example.com`, msg: "Bare innboksen" })).toMatchObject({ status: 200 });
    expect(await recipientEmails()).toBe(before);
    const [row] = await db().execute<Row>(sql`select status from commerce.form_submissions where store_id = ${storeId}::uuid order by created_at desc limit 1`);
    expect(row.status).toBe("sent");
  });

  it("follows a form's own choice over the desk's (D705 F3), and never keeps a message while the desk is off", async () => {
    const answers = [{ label: "Melding", value: "Hei" }];
    const contact = { email: `choice-${run}@example.com`, name: null };
    const form = (inbox: "email" | "inbox" | "both") => ({ blockId: block, subject: "S", path, lang: "nb", inbox });
    await setDesk("people", "inbox_and_email");
    expect(await formToInbox(storeId, form("email"), answers, contact)).toEqual({ kept: false });
    expect(await formToInbox(storeId, form("inbox"), answers, contact)).toMatchObject({ kept: true, emailToo: false });
    await setDesk("people", "email");
    expect(await formToInbox(storeId, form("both"), answers, contact)).toMatchObject({ kept: true, emailToo: true });
    await setDesk("off", "inbox");
    expect(await formToInbox(storeId, form("inbox"), answers, contact)).toEqual({ kept: false });
  });

  it("stays with people with the AI first: it starts in the queue and is never given to the AI, and its summary is never written", async () => {
    await setDesk("ai_first", "inbox");
    expect(await send({ name: "Lise", mail: `lise-${run}@example.com`, msg: "Kan dere sende til Tromsø?" })).toMatchObject({ status: 200 });
    const c = await latest();
    expect(c).toMatchObject({ handler: "queue", contact_email: `lise-${run}@example.com` });
    const desk = systemDesk(storeId);
    const id = String(c.id);
    await support.transition(desk, id, "claim", { kind: "agent", id: owner, name: "Kari" });
    await expect(support.transition(desk, id, "hand_back", { kind: "agent", id: owner, name: "Kari" })).rejects.toThrow();
    // A person's answer goes back by email to the address the form gave.
    await support.addMessage(desk, id, "agent", owner, "Ja, vi sender til hele landet.", { data: { name: "Kari" } });
    // Sent once the answer has settled: the job run a while later.
    await sendReplyEmails(new Date(Date.now() + 10 * 60_000));
    const [email] = await db().execute<Row>(sql`select kind, text from commerce.email_messages where to_address = ${`lise-${run}@example.com`}`);
    expect(email).toMatchObject({ kind: "support.reply" });
    expect(String(email.text)).toContain("Ja, vi sender til hele landet.");
    await support.transition(desk, id, "end", { kind: "agent", id: owner, name: "Kari" });
    expect((await latest()).summary_status).toBe("skipped");
  });

  // D797 (100-day B2): with the desk's form_ai on, or in the challenge, a form's message starts with the AI and is answered as an email's.
  it("starts with the AI when the desk lets it answer forms, answers by email with no customer, and stays with people otherwise", async () => {
    const turns: { email?: boolean; customer: unknown }[] = [];
    const turn: Turn = async (desk, _context, conversationId, _input, customer, _admin, channel) => {
      turns.push({ email: channel?.email, customer });
      await support.addMessage(desk, conversationId, "ai", null, "Ja, vi sender til Tromsø.");
      return { reply: null };
    };
    const answers = [{ label: "Melding", value: "Sender dere til Tromsø?" }];
    const form = { blockId: block, subject: "Spørsmål", path, lang: "nb", inbox: "inbox" as const };
    const run2 = async (email: string | null) => {
      const kept = await formToInbox(storeId, form, answers, { email, name: "Mona" }, { turn });
      for (const task of background.tasks.splice(0)) await task();
      return kept;
    };
    background.on = true;
    await db().execute(sql`insert into commerce.chat_agents (store_id, enabled, name) values (${storeId}::uuid, true, 'Ingrid') on conflict do nothing`);
    await setDesk("ai_first", "inbox");
    await db().execute(sql`update commerce.support_settings set form_ai = true where store_id = ${storeId}::uuid`);
    try {
      const kept = await run2(`mona-${run}@example.com`);
      expect(kept).toMatchObject({ kept: true });
      expect(turns).toEqual([{ email: true, customer: null }]);
      expect(await latest()).toMatchObject({ handler: "ai", status: "open", contact_email: `mona-${run}@example.com` });
      const said = await db().execute<Row>(sql`select author, body from commerce.support_messages where conversation_id = ${String((await latest()).id)}::uuid and author = 'ai'`);
      expect(said.map((m) => m.body)).toEqual(["Ja, vi sender til Tromsø."]);

      // Without an address to answer, with people only, or for a store with sensitive information: people answer.
      await run2(null);
      expect(await latest()).toMatchObject({ handler: "queue" });
      await setDesk("people", "inbox");
      await run2(`mona-${run}@example.com`);
      expect(await latest()).toMatchObject({ handler: "queue" });
      await setDesk("ai_first", "inbox");
      await db().execute(sql`update commerce.support_settings set form_ai = false where store_id = ${storeId}::uuid`);
      await run2(`mona-${run}@example.com`);
      expect(await latest()).toMatchObject({ handler: "queue" });
      expect(turns).toHaveLength(1);
    } finally {
      background.on = false;
      await db().execute(sql`update commerce.support_settings set form_ai = false where store_id = ${storeId}::uuid`);
    }
  });

  it("lets the AI read the orders of a form's address only once the customer wrote in it by email (D797)", async () => {
    await setDesk("people", "inbox");
    const address = `reader-${run}@example.com`;
    await db().execute(sql`insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${address}, 'Reader')`);
    await db().execute(sql`update commerce.support_settings set email_orders = true where store_id = ${storeId}::uuid`);
    try {
      const kept = await formToInbox(storeId, { blockId: block, subject: "S", path, lang: "nb", inbox: "inbox" }, [{ label: "Melding", value: "Hvor er pakken?" }], { email: address, name: null });
      if (!kept.kept) throw new Error("not kept");
      const desk = systemDesk(storeId);
      const settings = (await support.deskSettings(desk))!;
      // Only typed in a form: no customer.
      expect(await emailCustomer(desk, settings, kept.conversationId)).toBeNull();
      // A reply by email from the address (its DMARC check passed on the way in) proves it.
      await support.addMessage(desk, kept.conversationId, "customer", null, "Ordre 1001", { data: { email: { attachments: 0, cut: false } } });
      expect(await emailCustomer(desk, settings, kept.conversationId)).toMatchObject({ email: address });
    } finally {
      await db().execute(sql`update commerce.support_settings set email_orders = false where store_id = ${storeId}::uuid`);
    }
  });

  it("shows a customer with the address, never tying the conversation to them", async () => {
    await setDesk("people", "inbox");
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${`mona-${run}@example.com`}, 'Mona') returning id
    `);
    await send({ name: "Mona", mail: `MONA-${run}@example.com`, msg: "Hvor er pakken min?" });
    const c = await latest();
    const view = await support.staffConversation(systemDesk(storeId), String(c.id));
    expect(view).toMatchObject({ source: "form", signedIn: false, addressCustomer: String(customer.id) });
    expect(c.customer_id).toBeNull();
  });

  it("refuses a form's conversation on a desk that is off, in the database", async () => {
    await setDesk("off");
    await expect(
      db().execute(sql`
        insert into commerce.support_conversations (store_id, source, handler, market, locale) values (${storeId}::uuid, 'form', 'queue', 'no', 'nb-NO')
      `),
    ).rejects.toThrow();
  });

  it("cuts a long message into whole parts the inbox keeps, and says when something was left out", () => {
    const long = { label: "Melding", value: `${"ord ".repeat(400)}\n${"mer ".repeat(400)}` };
    const { parts, cut } = formMessageParts([long], 1000, 8);
    expect(cut).toBe(false);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(`Melding: ${long.value}`.replace(/\s+/g, " ").trim());
    expect(formMessageParts([long], 1000, 2).cut).toBe(true);
  });
});
