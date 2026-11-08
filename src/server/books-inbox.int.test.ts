import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
const background = vi.hoisted(() => ({ tasks: [] as (() => unknown)[] }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => background.tasks.push(task),
}));

const { closeDb, db } = await import("@/db/client");
const inbox = await import("./books-inbox");
const inbound = await import("./support-inbound");
const { importBankStatement } = await import("./bank-statements");
const { postPurchaseFromBank } = await import("./purchases");

import type { Membership } from "./auth";
import type { DocumentStorage } from "./invoice-storage";

type Row = Record<string, unknown>;

/**
 * The books' inbox (D504) against a real database, with Resend and the bucket as stand-ins: a mail to the store's books address keeps its
 * PDF (not the logo inline in it, nor a file that is no PDF or picture), once however often it comes; the document waits, is read back,
 * becomes a purchase's receipt and is then used, its file gone; another is set aside. A mail that fails DMARC keeps nothing, and a document
 * never changes again once used or set aside.
 */

const run = Date.now().toString(36);
const DOMAIN = "in.example.com";
const env = { SUPPORT_INBOUND_DOMAIN: DOMAIN, RESEND_API_KEY: "re_test" };
afterAll(async () => closeDb());

function memoryBucket(): DocumentStorage & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async upload(path, bytes) {
      if (files.has(path)) return false;
      files.set(path, bytes);
      return true;
    },
    async download(path) {
      return files.get(path) ?? null;
    },
    async remove(paths) {
      for (const p of paths) files.delete(p);
      return true;
    },
  };
}

const PDF = new TextEncoder().encode("%PDF-1.7\n% Anthropic receipt 2291-4410\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** Resend: the received emails by id, their attachments' addresses, and the files behind them. */
const emails = new Map<string, Record<string, unknown>>();
const files = new Map<string, Uint8Array>();
const fakeFetch = (async (url: string) => {
  const u = String(url);
  if (u.startsWith("https://files.example.com/")) {
    const bytes = files.get(u);
    return bytes ? new Response(Buffer.from(bytes)) : new Response("", { status: 404 });
  }
  const attachment = u.match(/\/emails\/receiving\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachment) return Response.json({ id: attachment[2], download_url: `https://files.example.com/${attachment[1]}/${attachment[2]}` });
  const email = emails.get(decodeURIComponent(u.split("/").pop() ?? ""));
  return email ? Response.json(email) : new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

async function books(): Promise<{ storeId: string; bookId: string; member: Membership }> {
  const name = `inbox-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Innboks') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Innboks', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Innboks AS', 'NO', 'NOK', '2026-08-01', ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k from (values (1920, 'asset')) as a(n, k)`);
  return { storeId, bookId, member: { account: { id: String(owner.id) }, store: { id: storeId } } as unknown as Membership };
}

let counter = 0;
async function mail(to: string, email: Record<string, unknown>, bucket: DocumentStorage, attached: Record<string, Uint8Array> = {}) {
  const id = `em_${run}_${++counter}`;
  for (const [attachment, bytes] of Object.entries(attached)) files.set(`https://files.example.com/${id}/${attachment}`, bytes);
  emails.set(id, { from: "Anthropic, PBC <invoice+statements@mail.anthropic.com>", subject: "Your receipt from Anthropic, PBC #2291-4410", headers: {}, ...email });
  await inbound.receiveInboundEvent({ type: "email.received", data: { email_id: id, from: "invoice+statements@mail.anthropic.com", to: [to], subject: "Your receipt" } }, { fetch: fakeFetch, env, storage: bucket });
  for (const task of background.tasks.splice(0)) await task();
  const [row] = await db().execute<Row>(sql`select status, reason, purpose from commerce.support_inbound_emails where provider_id = ${id}`);
  return { id, row };
}

describe("the books' inbox (D504)", () => {
  it("keeps a mail's receipt once, offers it, and takes it as a purchase's voucher", async () => {
    vi.stubEnv("SUPPORT_INBOUND_DOMAIN", DOMAIN);
    const { storeId, bookId, member } = await books();
    const bucket = memoryBucket();
    expect(await inbox.booksAddressOf(storeId, {})).toBeNull();
    const address = (await inbox.booksAddressOf(storeId, env))!;
    expect(address).toMatch(new RegExp(`^books-[a-z0-9]{20}@${DOMAIN.replace(/\./g, "\\.")}$`));
    expect(await inbox.booksAddressOf(storeId, env)).toBe(address);

    // A receipt by mail: its PDF kept, the logo inline and a text file left.
    const first = await mail(
      address,
      {
        attachments: [
          { id: "att_pdf", filename: "Receipt-2291-4410.pdf", content_type: "application/pdf", size: PDF.length, content_disposition: "attachment" },
          { id: "att_logo", filename: "logo.png", content_type: "image/png", size: PNG.length, content_disposition: "inline" },
          { id: "att_txt", filename: "notes.txt", content_type: "text/plain", size: 10 },
        ],
      },
      bucket,
      { att_pdf: PDF, att_logo: PNG },
    );
    expect(first.row).toMatchObject({ status: "done", purpose: "books" });
    const docs = await inbox.inboxDocuments(storeId, "Europe/Oslo");
    expect(docs).toEqual([{ id: expect.any(String), receivedOn: expect.any(String), from: "Anthropic, PBC <invoice+statements@mail.anthropic.com>", subject: "Your receipt from Anthropic, PBC #2291-4410", fileName: "Receipt-2291-4410.pdf" }]);
    expect([...bucket.files.keys()]).toEqual([`${storeId}/inbox/${docs[0].id}.pdf`]);

    // The same file again is kept once; a mail that fails DMARC keeps nothing; a mail without a file keeps nothing.
    expect((await mail(address, { attachments: [{ id: "att_pdf", filename: "again.pdf", content_type: "application/pdf", size: PDF.length }] }, bucket, { att_pdf: PDF })).row).toMatchObject({ status: "refused", reason: "no_attachment" });
    expect((await mail(address, { authentication: { dmarc: "fail" }, attachments: [{ id: "x", content_type: "application/pdf" }] }, bucket)).row).toMatchObject({ status: "refused", reason: "dmarc_fail" });
    expect(await inbox.inboxDocuments(storeId, "Europe/Oslo")).toHaveLength(1);

    // Read back for the store, never for another; then taken as the receipt of the card's charge.
    expect(await inbox.readInboxDocument(storeId, docs[0].id, { storage: bucket })).toEqual({ bytes: PDF, contentType: "application/pdf", fileName: "Receipt-2291-4410.pdf", status: "waiting" });
    expect(await inbox.readInboxDocument(crypto.randomUUID(), docs[0].id, { storage: bucket })).toBeNull();
    const camt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>NOK</Ccy></Acct>
      <Ntry><Amt Ccy="NOK">2205.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-11-04</Dt></BookgDt><AcctSvcrRef>${run}-a</AcctSvcrRef><AddtlNtryInf>Varekjøp ANTHROPIC USD 200,00</AddtlNtryInf></Ntry>
    </Stmt></BkToCstmrStmt></Document>`;
    expect(await importBankStatement(member, { name: "konto.xml", bytes: new TextEncoder().encode(camt) })).toMatchObject({ ok: true, newLines: 1 });
    const [line] = await db().execute<Row>(sql`select id from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-a`}`);
    const doc = (await inbox.readInboxDocument(storeId, docs[0].id, { storage: bucket }))!;
    const posted = await postPurchaseFromBank(member, String(line.id), { kind: "software", vatRate: 0, abroad: true }, { name: doc.fileName, bytes: doc.bytes }, { storage: bucket });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    await inbox.markInboxUsed(storeId, docs[0].id, posted.entryId, member.account.id, { storage: bucket });
    expect(await inbox.inboxDocuments(storeId, "Europe/Oslo")).toEqual([]);
    expect([...bucket.files.keys()]).toEqual([`${storeId}/vouchers/${posted.voucherId}.pdf`]);
    const [used] = await db().execute<Row>(sql`select status, entry_id from commerce.books_inbox where id = ${docs[0].id}::uuid`);
    expect(used).toEqual({ status: "used", entry_id: posted.entryId });

    // Used, it changes no more and is never deleted; another is set aside once.
    await expect(db().execute(sql`update commerce.books_inbox set status = 'waiting', entry_id = null where id = ${docs[0].id}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`delete from commerce.books_inbox where id = ${docs[0].id}::uuid`)).rejects.toThrow();
    const png = new Uint8Array([...PNG, 1, 2, 3]);
    expect((await mail(address, { subject: "Fwd: lunsj", attachments: [{ id: "att_photo", filename: "photo.png", content_type: "image/png", size: png.length }] }, bucket, { att_photo: png })).row).toMatchObject({ status: "done" });
    const [photo] = await inbox.inboxDocuments(storeId, "Europe/Oslo");
    expect(await inbox.dismissInboxDocument(member, photo.id, { storage: bucket })).toBe(true);
    expect(await inbox.dismissInboxDocument(member, photo.id, { storage: bucket })).toBe(false);
    expect(await inbox.readInboxDocument(storeId, photo.id, { storage: bucket })).toBeNull();
    vi.unstubAllEnvs();
  });
});
