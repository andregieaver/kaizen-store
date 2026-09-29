import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { buildCsv, invoiceListToCsv, paymentsToCsv } from "@/lib/work-csv";

import type { InvoiceResult, WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const invoices = await import("./work-invoices");
const emails = await import("./work-emails");
const exportsModule = await import("./work-exports");

/**
 * Work's emails and hosted link (docs/work.md 4.7, WP7b) from real data: an issued invoice's email is kept and logged when
 * Resend is not set up, goes once (idempotent) unless a person sends it again, refuses drafts and other stores' invoices,
 * carries the hosted page's link whose token finds the invoice (and only issued ones), and writes one `invoice.emailed`
 * event without repeating what the database writes.
 */

const run = Date.now().toString(36);
const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };

beforeAll(() => {
  // Email is "not set up": what is sent is only kept and logged.
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

afterAll(async () => {
  if (saved.key !== undefined) process.env.RESEND_API_KEY = saved.key;
  if (saved.from !== undefined) process.env.EMAIL_FROM = saved.from;
  await closeDb();
});

async function makeStore(tag: string): Promise<{ storeId: string; slug: string; actor: WorkActor }> {
  const name = `we-${tag}-${run}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`,
  );
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
      postal_address = 'Storgata 1, 0150 Oslo', country = 'NO', contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, 'NO923456789MVA', 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  return { storeId, slug: name, actor: { account: { id: String(owner.id) }, store: { id: storeId } } };
}

async function makeClient(storeId: string, name: string, email: string | null, locale = "sv-SE"): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, country, billing_address, currency, default_hourly_rate_minor,
                                       locale, business, vat_treatment, billing_email)
    values (${storeId}::uuid, ${name}, 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 150000,
            ${locale}, true, 'domestic', ${email})
    returning id`);
  return String(row.id);
}

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

async function draftFor(actor: WorkActor, clientId: string): Promise<string> {
  const id = ok(await invoices.createDraftInvoice(actor, { clientId })).invoiceId;
  ok(
    await invoices.saveLines(actor, id, [
      { description: "Workshop", unit: "hour", quantityHundredths: 400, unitPriceMinor: 100_000, discountBp: 0, vatCategory: "standard" },
    ]),
  );
  return id;
}

const issue = async (actor: WorkActor, draft: string) => ok(await invoices.issueInvoice(actor, { invoiceId: draft })).invoice;

const emailRows = (storeId: string, kind?: string) =>
  db().execute<Row>(sql`
    select kind, to_address, subject, html, text, status, idempotency_key from commerce.email_messages
    where store_id = ${storeId}::uuid ${kind ? sql`and kind = ${kind}` : sql``} order by created_at, id`);

const events = async (storeId: string, invoiceId: string) =>
  (
    await db().execute<Row>(sql`
      select type, data, account_id from commerce.work_events
      where store_id = ${storeId}::uuid and entity_type = 'invoice' and entity_id = ${invoiceId}::uuid order by id`)
  ).map((r) => String(r.type));

describe("Work invoice emails from real data", () => {
  it("keeps and logs the email of an issued invoice, once, and records it", async () => {
    const { storeId, slug, actor } = await makeStore("main");
    const client = await makeClient(storeId, "Kund AB", "faktura@kund.se");
    const draft = await draftFor(actor, client);

    // A draft is never sent, and nothing is kept for it.
    expect(await emails.sendInvoiceEmail(storeId, draft, { by: actor.account?.id })).toEqual({ sent: false, reason: "not_issued" });
    expect(await emails.hostedInvoiceUrl(storeId, draft)).toBeNull();
    expect(await emailRows(storeId)).toHaveLength(0);

    const issued = await issue(actor, draft);
    const result = await emails.sendInvoiceEmail(storeId, issued.invoiceId, { by: actor.account?.id });
    expect(result).toMatchObject({ sent: true, outcome: "logged", to: "faktura@kund.se" });

    const [row, ...more] = await emailRows(storeId, "work.invoice");
    expect(more).toHaveLength(0);
    expect(row.to_address).toBe("faktura@kund.se");
    expect(row.status).toBe("logged");
    expect(row.idempotency_key).toBe(`work-invoice:${issued.invoiceId}`);
    // In the client's language (Swedish), with the hosted link and the frozen amount and number.
    expect(String(row.subject)).toBe(`Faktura ${issued.documentNumber} från Arbeid`);
    expect(String(row.html)).toContain('lang="sv"');
    expect(String(row.text)).toContain(issued.documentNumber);
    expect(String(row.text)).toContain(`/account/invoice/${issued.publicToken}`);
    expect(String(row.text)).toContain("Konsulent AS");

    // It is recorded: where it went, and one `invoice.emailed` event next to the database's own `invoice.issued`.
    const [inv] = await db().execute<Row>(sql`select sent_to from commerce.work_invoices where id = ${issued.invoiceId}::uuid`);
    expect(inv.sent_to).toBe("faktura@kund.se");
    const types = await events(storeId, issued.invoiceId);
    expect(types.filter((t) => t === "invoice.issued")).toHaveLength(1);
    expect(types.filter((t) => t === "invoice.emailed")).toHaveLength(1);
    const [event] = await db().execute<Row>(sql`
      select data::text as data, account_id from commerce.work_events
      where store_id = ${storeId}::uuid and entity_id = ${issued.invoiceId}::uuid and type = 'invoice.emailed'`);
    expect(String(event.data)).not.toContain("@");
    expect(String(event.account_id)).toBe(actor.account?.id);

    // Again (an automatic retry): refused as already sent, nothing new kept, no second event.
    expect(await emails.sendInvoiceEmail(storeId, issued.invoiceId)).toEqual({ sent: false, reason: "already_sent" });
    expect(await emailRows(storeId, "work.invoice")).toHaveLength(1);

    // A person pressing Send again, to another address with a note, makes a new email.
    const again = await emails.sendInvoiceEmail(storeId, issued.invoiceId, {
      resend: true,
      to: "ekonomi@kund.se",
      message: "Tack för samarbetet.",
    });
    expect(again).toMatchObject({ sent: true, to: "ekonomi@kund.se" });
    const all = await emailRows(storeId, "work.invoice");
    expect(all).toHaveLength(2);
    expect(String(all[1].text)).toContain("Tack för samarbetet.");
    expect(all[1].idempotency_key).toBeNull();

    // The hosted address and the token that finds the invoice are the same throughout.
    const url = await emails.hostedInvoiceUrl(storeId, issued.invoiceId);
    expect(url).toContain(`/account/invoice/${issued.publicToken}`);
    expect(url).toContain(slug);
    expect(await invoices.findInvoiceByToken(issued.publicToken)).toEqual({ storeId, invoiceId: issued.invoiceId });
  });

  it("refuses another store's invoice and sends nothing", async () => {
    const a = await makeStore("a");
    const b = await makeStore("b");
    const client = await makeClient(a.storeId, "Kund", "k@kund.se");
    const issued = await issue(a.actor, await draftFor(a.actor, client));
    expect(await emails.sendInvoiceEmail(b.storeId, issued.invoiceId)).toEqual({ sent: false, reason: "not_found" });
    expect(await emails.sendPaymentReminderEmail(b.storeId, issued.invoiceId)).toEqual({ sent: false, reason: "not_found" });
    expect(await emails.hostedInvoiceUrl(b.storeId, issued.invoiceId)).toBeNull();
    expect(await emails.sendInvoiceEmail(a.storeId, "not-a-uuid")).toEqual({ sent: false, reason: "not_found" });
    expect(await emailRows(a.storeId)).toHaveLength(0);
    expect(await emailRows(b.storeId)).toHaveLength(0);
    // The token belongs to store a: the page compares the store it is opened in with it.
    expect((await invoices.findInvoiceByToken(issued.publicToken))?.storeId).toBe(a.storeId);
  });

  it("makes a token when the invoice has none, and a token only ever finds an issued invoice", async () => {
    const { storeId, actor } = await makeStore("token");
    const client = await makeClient(storeId, "Kund", "k@kund.se", "en-GB");
    const draft = await draftFor(actor, client);
    const [before] = await db().execute<Row>(sql`select public_token from commerce.work_invoices where id = ${draft}::uuid`);
    expect(before.public_token).toBeNull();
    expect(await invoices.findInvoiceByToken("A".repeat(32))).toBeNull();

    const issued = await issue(actor, draft);
    await db().execute(sql`update commerce.work_invoices set public_token = null where id = ${issued.invoiceId}::uuid`);
    expect(await invoices.findInvoiceByToken(issued.publicToken)).toBeNull();

    expect((await emails.sendInvoiceEmail(storeId, issued.invoiceId)).sent).toBe(true);
    const [after] = await db().execute<Row>(sql`select public_token from commerce.work_invoices where id = ${issued.invoiceId}::uuid`);
    const token = String(after.public_token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(token).not.toBe(issued.publicToken);
    expect(await invoices.findInvoiceByToken(token)).toEqual({ storeId, invoiceId: issued.invoiceId });
    // English client: English email.
    const [row] = await emailRows(storeId, "work.invoice");
    expect(String(row.subject)).toBe(`Invoice ${issued.documentNumber} from Arbeid`);
  });

  it("needs an address that is one, and tries a failed first send again once", async () => {
    const { storeId, actor } = await makeStore("addr");
    const client = await makeClient(storeId, "Utan Post", null);
    const issued = await issue(actor, await draftFor(actor, client));
    expect(await emails.sendInvoiceEmail(storeId, issued.invoiceId)).toEqual({ sent: false, reason: "no_email" });
    expect(await emails.sendInvoiceEmail(storeId, issued.invoiceId, { to: "not an address" })).toEqual({
      sent: false,
      reason: "invalid_email",
    });
    expect(await emailRows(storeId)).toHaveLength(0);

    // A first send that failed at the provider is made again, once it works.
    const first = await emails.sendInvoiceEmail(storeId, issued.invoiceId, { to: "ok@kund.se" });
    expect(first.sent).toBe(true);
    await db().execute(sql`update commerce.email_messages set status = 'failed' where store_id = ${storeId}::uuid`);
    expect(await emails.sendInvoiceEmail(storeId, issued.invoiceId, { to: "ok@kund.se" })).toMatchObject({ sent: true });
    expect(await emails.sendInvoiceEmail(storeId, issued.invoiceId, { to: "ok@kund.se" })).toEqual({
      sent: false,
      reason: "already_sent",
    });
    const rows = await emailRows(storeId, "work.invoice");
    expect(rows.filter((r) => r.status === "failed")).toHaveLength(1);
    expect(rows.filter((r) => r.idempotency_key === `work-invoice:${issued.invoiceId}`)).toHaveLength(1);
  });

  it("sends a reminder for an open invoice once a day, and a credit note with a link to it", async () => {
    const { storeId, actor } = await makeStore("rem");
    const client = await makeClient(storeId, "Kunde", "kunde@example.no", "nb-NO");
    const issued = await issue(actor, await draftFor(actor, client));

    expect(await emails.sendPaymentReminderEmail(storeId, issued.invoiceId)).toMatchObject({ sent: true });
    expect(await emails.sendPaymentReminderEmail(storeId, issued.invoiceId)).toEqual({ sent: false, reason: "already_sent" });
    const [reminder] = await emailRows(storeId, "work.reminder");
    expect(String(reminder.subject)).toBe(`Påminnelse: faktura ${issued.documentNumber} fra Arbeid`);
    expect((await events(storeId, issued.invoiceId)).filter((t) => t === "invoice.reminded")).toHaveLength(1);

    // A partial credit note, sent with its own link on the invoice's page.
    const detail = (await invoices.getWorkInvoiceDetail(storeId, issued.invoiceId))!;
    const credit = ok(
      await invoices.creditInvoice(actor, {
        invoiceId: issued.invoiceId,
        kind: "partial",
        reason: "Too many hours",
        lines: [{ lineId: detail.lines[0].id, quantityHundredths: 100 }],
      }),
    ).creditNote;
    const sent = await emails.sendCreditNoteEmail(storeId, credit.creditNoteId, { by: actor.account?.id });
    expect(sent).toMatchObject({ sent: true, to: "kunde@example.no" });
    expect(await emails.sendCreditNoteEmail(storeId, credit.creditNoteId)).toEqual({ sent: false, reason: "already_sent" });
    const [note] = await emailRows(storeId, "work.credit_note");
    expect(String(note.subject)).toContain("Kreditnota");
    expect(String(note.text)).toContain(`?credit=${credit.creditNoteId}`);
    expect(String(note.text)).toContain(`faktura ${issued.documentNumber}`);

    // Paid in full (partly credited, the rest paid): nothing is left to remind about.
    const owed = (await invoices.getWorkInvoiceDetail(storeId, issued.invoiceId))!.amounts.outstandingMinor;
    ok(
      await invoices.recordPayment(actor, {
        invoiceId: issued.invoiceId,
        amountMinor: owed,
        receivedOn: new Date().toISOString().slice(0, 10),
        method: "bank",
      }),
    );
    expect(await emails.sendPaymentReminderEmail(storeId, issued.invoiceId)).toEqual({ sent: false, reason: "not_open" });

    // Another store's credit note is not found.
    const other = await makeStore("rem-other");
    expect(await emails.sendCreditNoteEmail(other.storeId, credit.creditNoteId)).toEqual({ sent: false, reason: "not_found" });
  });

  it("exports the register and the payments of the store, and only its own, safe for spreadsheets", async () => {
    const a = await makeStore("csv-a");
    const b = await makeStore("csv-b");
    const client = await makeClient(a.storeId, '=HYPERLINK("http://evil","x")', "k@kund.se", "en-GB");
    const draft = await draftFor(a.actor, client);
    const issued = await issue(a.actor, draft);
    const today = new Date().toISOString().slice(0, 10);
    ok(
      await invoices.recordPayment(a.actor, {
        invoiceId: issued.invoiceId,
        amountMinor: 100_000,
        receivedOn: today,
        method: "bank",
        reference: "+cmd",
      }),
    );
    // A draft is not in the register.
    await draftFor(a.actor, await makeClient(a.storeId, "Second", "s@kund.se"));

    const register = await exportsModule.invoiceRegister(a.storeId, {});
    expect(register).toHaveLength(1);
    expect(register[0]).toMatchObject({
      documentNumber: issued.documentNumber,
      subtotalMinor: 400_000,
      vatMinor: 100_000,
      totalMinor: 500_000,
      paidMinor: 100_000,
      currency: "NOK",
    });
    const csv = invoiceListToCsv(register);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain("4000.00");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);

    const payments = await exportsModule.paymentRegister(a.storeId);
    expect(payments).toHaveLength(1);
    expect(paymentsToCsv(payments)).toContain("'+cmd");
    expect(payments[0]).toMatchObject({ amountMinor: 100_000, method: "bank", documentNumber: issued.documentNumber });
    expect(await exportsModule.paymentRegister(a.storeId, { from: "2999-01-01" })).toHaveLength(0);

    // Another store sees none of it.
    expect(await exportsModule.invoiceRegister(b.storeId, {})).toHaveLength(0);
    expect(await exportsModule.paymentRegister(b.storeId)).toHaveLength(0);
    expect(buildCsv([["x"]])).toBe("x\r\n");
  });
});
