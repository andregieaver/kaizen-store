import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { CreditNoteSnapshot } from "@/lib/credit-allocation";
import type { DocumentKind } from "@/lib/document-token";
import type { OrderInvoiceSnapshot } from "@/lib/invoice-snapshot";

import { launchBrowser } from "./browser";
import { documentHtml } from "./document-html";
import { documentStorage, pdfPathOf, readPdf, type DocumentStorage } from "./invoice-storage";
import { PDF_ATTEMPTS } from "./invoices";

type Row = Record<string, unknown>;

/**
 * The PDF of an invoice or a credit note (D159, `docs/wave-1b-invoices.md` 4.9). It is the same React view the hosted and print pages
 * draw (`documentHtml()`), loaded into Chromium with every request refused, printed to A4, and kept **once** in the private
 * `documents` bucket with its SHA-256 on the document (`pdf_path`/`pdf_sha256`, the one change the database allows). A staff reprint and
 * the shopper's download are therefore the same file. When Chromium or the storage fails the document is untouched: the caller falls back
 * to the print page, a failure is counted in `document_pdf_state`, and the job tries again up to `PDF_ATTEMPTS` times.
 *
 * The only module (with the routes that render, and `/api/cron/document-pdfs`) that imports Chromium: each is in `outputFileTracingIncludes`.
 */

/** Renders one HTML page to PDF bytes. */
export type PdfRenderer = (html: string) => Promise<Uint8Array>;

export type PdfDeps = {
  render?: PdfRenderer;
  html?: (snapshot: OrderInvoiceSnapshot | CreditNoteSnapshot) => string | Promise<string>;
  /** Null: no storage on this server (nothing is stored and the file is made on every request). */
  storage?: DocumentStorage | null;
};

const RENDER_TIMEOUT_MS = 20_000;
/** A PDF larger than this is not made (a document is one or two pages; a larger one is a fault). */
const MAX_PDF_BYTES = 5 * 1024 * 1024;
/** What a failed PDF waits before the job tries it again. */
const RETRY_AFTER_MINUTES = 5;

/** Chromium: the page is set directly (no request), JavaScript is off, and any request the page makes anyway is aborted. */
export const renderPdf: PdfRenderer = async (html) => {
  const browser = await launchBrowser();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.route("**/*", (route) => route.abort());
      await page.setContent(html, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
      const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" }, preferCSSPageSize: true });
      return new Uint8Array(pdf);
    })();
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The PDF took too long to make.")), RENDER_TIMEOUT_MS);
    });
    return await Promise.race([work, limit]);
  } finally {
    if (timer) clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const table = (kind: DocumentKind) => (kind === "invoice" ? sql`commerce.invoices` : sql`commerce.credit_notes`);

export type PdfOutcome =
  | { ok: true; bytes: Uint8Array; /** Served from storage, or made and stored now. False: made for this request only (nothing could be stored). */ stored: boolean; fileName: string }
  | { ok: false; reason: "not_found" | "anonymised" | "busy" | "render_failed" };

/** Notes a failed attempt (the error cut to 200 characters, never a name). */
async function noteFailure(storeId: string, kind: DocumentKind, id: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 200);
  try {
    await db().execute(sql`
      insert into commerce.document_pdf_state (store_id, document_type, document_id, attempts, last_attempt_at, last_error)
      values (${storeId}::uuid, ${kind}, ${id}::uuid, 1, now(), ${message})
      on conflict (store_id, document_type, document_id) do update
        set attempts = commerce.document_pdf_state.attempts + 1, last_attempt_at = now(), last_error = excluded.last_error
    `);
  } catch {
    // A failure to note a failure changes nothing.
  }
}

/**
 * The document's PDF: the stored file when there is one, else made now, stored once and served. Never throws: the outcome says why not.
 * Two requests at once do not both render (a transaction-scoped advisory lock per document; the one that does not get it is `busy` and the
 * caller falls back to the print page), and the loser of a race to store adopts the winner's file.
 */
export async function ensureDocumentPdf(storeId: string, kind: DocumentKind, documentId: string, deps: PdfDeps = {}): Promise<PdfOutcome> {
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  const [doc] = await db().execute<Row>(sql`
    select document_number, pdf_path, snapshot, anonymised_at is not null as anonymised from ${table(kind)}
    where store_id = ${storeId}::uuid and id = ${documentId}::uuid
  `);
  if (!doc) return { ok: false, reason: "not_found" };
  if (doc.anonymised === true) return { ok: false, reason: "anonymised" };
  const fileName = String(doc.document_number);

  if (doc.pdf_path && storage) {
    const bytes = await storage.download(String(doc.pdf_path)).catch(() => null);
    if (bytes && bytes.length > 0) return { ok: true, bytes, stored: true, fileName };
    // The row says there is a file and the object is gone: it is made again for this request; the path cannot be set a second time.
  }

  try {
    const key = `document-pdf:${kind}:${documentId}`;
    return await db().transaction(async (tx): Promise<PdfOutcome> => {
      const [lock] = await tx.execute<Row>(sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as got`);
      if (lock?.got !== true) return { ok: false, reason: "busy" };
      const snapshot = doc.snapshot as OrderInvoiceSnapshot | CreditNoteSnapshot;
      const html = await (deps.html ?? documentHtml)(snapshot);
      const bytes = await (deps.render ?? renderPdf)(html);
      if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) throw new Error("The PDF was empty or too large.");

      if (!storage || doc.pdf_path) return { ok: true, bytes, stored: false, fileName };
      const path = pdfPathOf(storeId, kind, documentId);
      let kept = bytes;
      if (!(await storage.upload(path, bytes, "application/pdf"))) {
        // Already there (another server made it first, but the row was not written): the stored file is the one everybody gets.
        const there = await storage.download(path).catch(() => null);
        if (!there || there.length === 0) return { ok: true, bytes, stored: false, fileName };
        kept = there;
      }
      const set = await tx.execute<Row>(sql`
        update ${table(kind)} set pdf_path = ${path}, pdf_sha256 = ${sha256(kept)}
        where store_id = ${storeId}::uuid and id = ${documentId}::uuid and pdf_path is null
        returning id
      `);
      if (set.length === 0) return { ok: true, bytes: kept, stored: true, fileName };
      await tx.execute(sql`
        update commerce.document_pdf_state set attempts = 0, last_error = null
        where store_id = ${storeId}::uuid and document_type = ${kind} and document_id = ${documentId}::uuid
      `);
      return { ok: true, bytes: kept, stored: true, fileName };
    });
  } catch (error) {
    await noteFailure(storeId, kind, documentId, error);
    return { ok: false, reason: "render_failed" };
  }
}

export const ensureInvoicePdf = (storeId: string, invoiceId: string, deps?: PdfDeps) => ensureDocumentPdf(storeId, "invoice", invoiceId, deps);
export const ensureCreditNotePdf = (storeId: string, creditNoteId: string, deps?: PdfDeps) => ensureDocumentPdf(storeId, "credit_note", creditNoteId, deps);

/** *Try again* on the Waiting tab: forgets the failed attempts and makes the file now. */
export async function retryDocumentPdf(storeId: string, kind: DocumentKind, documentId: string, deps?: PdfDeps): Promise<PdfOutcome> {
  await db().execute(sql`
    update commerce.document_pdf_state set attempts = 0 where store_id = ${storeId}::uuid and document_type = ${kind} and document_id = ${documentId}::uuid
  `);
  return ensureDocumentPdf(storeId, kind, documentId, deps);
}

export { readPdf };

export type PdfJobResult = { made: number; failed: number; skipped: number };

/**
 * The job behind `/api/cron/document-pdfs`: makes up to `limit` missing PDFs, oldest first, leaving out documents that failed five times
 * and ones that failed in the last five minutes. Never throws.
 */
export async function pdfJob({ limit = 10, storeId = null, deps = {} }: { limit?: number; /** Only this store's documents (an owner's own *Check again*); the cron passes none. */ storeId?: string | null; deps?: PdfDeps } = {}): Promise<PdfJobResult> {
  const result: PdfJobResult = { made: 0, failed: 0, skipped: 0 };
  if ((deps.storage === undefined ? documentStorage() : deps.storage) === null) return result;
  let todo: Row[];
  try {
    todo = await db().execute<Row>(sql`
      select x.store_id, x.kind, x.id from (
        select i.store_id, 'invoice'::text as kind, i.id, i.issued_at from commerce.invoices i where i.pdf_path is null and i.anonymised_at is null
        union all
        select c.store_id, 'credit_note', c.id, c.issued_at from commerce.credit_notes c where c.pdf_path is null and c.anonymised_at is null
      ) x
      left join commerce.document_pdf_state s on s.store_id = x.store_id and s.document_type = x.kind and s.document_id = x.id
      where coalesce(s.attempts, 0) < ${PDF_ATTEMPTS}
        ${storeId ? sql`and x.store_id = ${storeId}::uuid` : sql``}
        and (s.last_attempt_at is null or s.last_attempt_at < now() - make_interval(mins => ${RETRY_AFTER_MINUTES}))
      order by x.issued_at
      limit ${Math.max(1, Math.min(50, limit))}
    `);
  } catch {
    return result;
  }
  for (const row of todo) {
    const outcome = await ensureDocumentPdf(String(row.store_id), row.kind === "invoice" ? "invoice" : "credit_note", String(row.id), deps);
    if (outcome.ok && outcome.stored) result.made += 1;
    else if (outcome.ok || (!outcome.ok && outcome.reason === "busy")) result.skipped += 1;
    else result.failed += 1;
  }
  return result;
}
