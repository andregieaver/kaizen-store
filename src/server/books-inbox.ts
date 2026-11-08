import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { booksAddress, inboundDomain } from "@/lib/inbound-email";
import { INBOX_TYPES, type InboxDocument } from "@/lib/books-inbox";
import { voucherTypeOf } from "@/lib/purchases";

import { audit, type Membership } from "./auth";
import { documentStorage, type DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { VOUCHER_BYTES } from "./purchases";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The books' inbox (D504, subscriptions step 3): a store's books address (`books-{key}@` the receiving domain, D332), to which the owner
 * forwards receipts and invoices, or which they give their suppliers as the address bills go to. Each PDF or picture attached is kept in the
 * private `documents` bucket as a document waiting for its bank line (`commerce.books_inbox`), shown on Settings → Books and taken as the
 * receipt of a purchase from the bank (D490) with one press. Nothing is posted by mail alone. Mail Resend says failed DMARC is refused; the
 * key is random, and a store keeps at most `INBOX_PER_DAY` documents a day.
 */

/** The most documents a store's inbox takes in a day, and from one mail. */
export const INBOX_PER_DAY = 100;
const PER_MAIL = 10;

const RESEND_RECEIVING = "https://api.resend.com/emails/receiving";

const newKey = () => Array.from(randomBytes(20), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** The store's books address, made the first time it is asked for; null while receiving is not set up. */
export async function booksAddressOf(storeId: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const domain = inboundDomain(env.SUPPORT_INBOUND_DOMAIN);
  if (!domain) return null;
  await db().execute(sql`insert into commerce.books_email (store_id, key) values (${storeId}::uuid, ${newKey()}) on conflict (store_id) do nothing`);
  const row = await typedRow(z.object({ key: col.text }), sql`select key from commerce.books_email where store_id = ${storeId}::uuid`);
  return row ? booksAddress(row.key, domain) : null;
}

/** The store a books key is for, or null. */
export async function storeOfBooksKey(key: string): Promise<string | null> {
  const row = await typedRow(z.object({ store_id: col.uuid }), sql`select store_id from commerce.books_email where key = ${key}`);
  return row?.store_id ?? null;
}

export type ReceivedAttachment = { id?: unknown; filename?: unknown; content_type?: unknown; size?: unknown; content_disposition?: unknown };

/** What keeping a mail's attachments needs from outside, replaced in tests. */
export type InboxDeps = { fetch?: typeof fetch; env?: Record<string, string | undefined>; storage?: DocumentStorage | null };

/** One attachment's bytes from Resend: its download address first, then the file; null when Resend has none for it. */
async function attachmentBytes(providerId: string, attachmentId: string, deps: InboxDeps): Promise<Uint8Array | null> {
  const env = deps.env ?? process.env;
  const key = (env.RESEND_RECEIVING_KEY ?? env.RESEND_API_KEY)?.trim();
  if (!key?.startsWith("re_")) return null;
  const go = deps.fetch ?? fetch;
  const meta = await go(`${RESEND_RECEIVING}/${encodeURIComponent(providerId)}/attachments/${encodeURIComponent(attachmentId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (meta.status === 404) return null;
  if (!meta.ok) throw new Error(`Resend answered ${meta.status}`);
  const url = String(((await meta.json()) as { download_url?: unknown }).download_url ?? "");
  if (!url.startsWith("https://")) return null;
  const file = await go(url, { signal: AbortSignal.timeout(15_000) });
  if (!file.ok) throw new Error(`The attachment's download answered ${file.status}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return bytes.length <= VOUCHER_BYTES ? bytes : null;
}

/**
 * Keeps a received mail's PDFs and pictures in the store's inbox: each attached file (not a picture inline in the mail, such as a logo) of
 * a type the books keep and no larger than a voucher, read by its first bytes, kept once per store (the same file again is skipped). Throws
 * when Resend or the bucket fails, so the mail is tried again; what was kept stays kept.
 */
export async function keepInboxAttachments(
  storeId: string,
  mail: { providerId: string; from: string; subject: string | null; receivedAt: string; attachments: readonly ReceivedAttachment[] },
  deps: InboxDeps = {},
): Promise<{ status: "done" | "refused"; reason?: string; kept: number }> {
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  if (!storage) return { status: "refused", reason: "no_storage", kept: 0 };
  const [today] = await typedRows(
    z.object({ n: z.coerce.number() }),
    sql`select count(*)::int as n from commerce.books_inbox where store_id = ${storeId}::uuid and created_at > now() - interval '1 day'`,
  );
  let room = INBOX_PER_DAY - (today?.n ?? 0);
  if (room <= 0) return { status: "refused", reason: "inbox_limit", kept: 0 };
  const files = mail.attachments
    .filter((a) => typeof a.id === "string" && (INBOX_TYPES as readonly string[]).includes(String(a.content_type ?? "").toLowerCase()))
    .filter((a) => !(String(a.content_disposition ?? "").toLowerCase() === "inline" && String(a.content_type).startsWith("image/")))
    .filter((a) => Number(a.size ?? 0) <= VOUCHER_BYTES)
    .slice(0, PER_MAIL);
  if (files.length === 0) return { status: "refused", reason: "no_attachment", kept: 0 };
  let kept = 0;
  for (const a of files) {
    if (room <= 0) break;
    const bytes = await attachmentBytes(mail.providerId, String(a.id), deps);
    const type = bytes ? voucherTypeOf(bytes) : null;
    if (!bytes || !type) continue;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const seen = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.books_inbox where store_id = ${storeId}::uuid and sha256 = ${sha256}`);
    if (seen) continue;
    const id = randomUUID();
    const path = `${storeId}/inbox/${id}.${type.ext}`;
    if (!(await storage.upload(path, bytes, type.contentType))) throw new Error("The inbox document could not be kept");
    const name = String(a.filename ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || `document.${type.ext}`;
    const inserted = await typedRow(
      z.object({ id: col.uuid }),
      sql`insert into commerce.books_inbox (id, store_id, provider_id, from_address, subject, received_at, file_path, file_name, content_type, size_bytes, sha256)
          values (${id}::uuid, ${storeId}::uuid, ${mail.providerId.slice(0, 200)}, ${mail.from.slice(0, 320)}, ${mail.subject?.slice(0, 200) ?? null},
                  ${mail.receivedAt}::timestamptz, ${path}, ${name}, ${type.contentType}, ${bytes.length}, ${sha256})
          on conflict (store_id, sha256) do nothing returning id`,
    );
    if (!inserted) {
      await storage.remove([path]).catch(() => false);
      continue;
    }
    kept += 1;
    room -= 1;
  }
  log("info", "books_inbox.kept", { storeId, kept, offered: files.length });
  return kept > 0 ? { status: "done", kept } : { status: "refused", reason: "no_attachment", kept: 0 };
}

const DOC = z.object({ id: col.uuid, received_on: col.text, from_address: col.text, subject: col.textOrNull, file_name: col.text });

/** The documents waiting in the store's inbox, the newest first. */
export async function inboxDocuments(storeId: string, timeZone: string): Promise<InboxDocument[]> {
  const rows = await typedRows(
    DOC,
    sql`select id, (received_at at time zone ${timeZone})::date::text as received_on, from_address, subject, file_name from commerce.books_inbox
         where store_id = ${storeId}::uuid and status = 'waiting' order by received_at desc, id limit 200`,
  );
  return rows.map((r) => ({ id: r.id, receivedOn: r.received_on, from: r.from_address, subject: r.subject, fileName: r.file_name }));
}

/** An inbox document's file, for a member who may read the books, or for posting; null when it is another store's or cannot be read. */
export async function readInboxDocument(
  storeId: string,
  id: string,
  deps: { storage?: DocumentStorage | null } = {},
): Promise<{ bytes: Uint8Array; contentType: string; fileName: string; status: string } | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(
    z.object({ file_path: col.text, content_type: col.text, file_name: col.text, status: col.text }),
    sql`select file_path, content_type, file_name, status from commerce.books_inbox where store_id = ${storeId}::uuid and id = ${id}::uuid`,
  );
  if (!row || !row.file_path.startsWith(`${storeId}/inbox/`)) return null;
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  const bytes = storage ? await storage.download(row.file_path).catch(() => null) : null;
  return bytes ? { bytes, contentType: row.content_type, fileName: row.file_name, status: row.status } : null;
}

/** Marks a waiting document used by the entry it became the voucher of; its file then goes (the voucher keeps its own copy). */
export async function markInboxUsed(storeId: string, id: string, entryId: string, accountId: string, deps: { storage?: DocumentStorage | null } = {}): Promise<void> {
  const row = await typedRow(
    z.object({ file_path: col.text }),
    sql`update commerce.books_inbox set status = 'used', entry_id = ${entryId}::uuid, decided_at = now(), decided_by = ${accountId}::uuid
         where store_id = ${storeId}::uuid and id = ${id}::uuid and status = 'waiting' returning file_path`,
  );
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  if (row && storage) await storage.remove([row.file_path]).catch(() => false);
}

/** *Not for the books*: a waiting document set aside, its file gone. Audited. */
export async function dismissInboxDocument(member: Membership, id: string, deps: { storage?: DocumentStorage | null } = {}): Promise<boolean> {
  const storeId = member.store.id;
  const row = await typedRow(
    z.object({ file_path: col.text }),
    sql`update commerce.books_inbox set status = 'dismissed', decided_at = now(), decided_by = ${member.account.id}::uuid
         where store_id = ${storeId}::uuid and id = ${id}::uuid and status = 'waiting' returning file_path`,
  );
  if (!row) return false;
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  if (storage) await storage.remove([row.file_path]).catch(() => false);
  await audit(member.account.id, storeId, "work.books_inbox_dismissed", { documentId: id });
  return true;
}
