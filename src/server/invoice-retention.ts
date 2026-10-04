import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { documentStorage, isOwnDocumentPath, type DocumentStorage } from "./invoice-storage";

type Row = Record<string, unknown>;

/**
 * Removing the personal data of documents past their period (D159, `docs/wave-1b-invoices.md` 3.6): the hook of unit 1g's `runRetention()`.
 * `commerce.anonymise_expired_documents()` replaces a buyer's name, company, numbers, email and address in the snapshot with a marker and
 * takes away the hosted page's token and the PDF's path (it refuses a cutoff younger than five years and never deletes a document, a number
 * or an amount); the stored PDFs, which hold the same personal data, are removed here because storage cannot be reached from SQL. The
 * files are listed **before** the rows change, so a failure to remove one leaves the row changed and the file named in the result, never a
 * file whose row still points at it.
 */

export type AnonymiseResult = {
  /** Documents whose personal data was removed. */
  documents: number;
  /** Stored PDFs removed. */
  filesRemoved: number;
  /** Stored PDFs that could not be removed (still there; listed so they can be removed by hand). */
  filesLeft: string[];
};

export async function anonymiseDocuments(storeId: string, cutoff: string, deps: { storage?: DocumentStorage | null } = {}): Promise<AnonymiseResult> {
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  const files = (
    await db().execute<Row>(sql`select pdf_path from commerce.expired_document_files(${storeId}::uuid, ${cutoff}::date)`)
  )
    .map((r) => String(r.pdf_path))
    .filter((path) => isOwnDocumentPath(storeId, path));
  const [row] = await db().execute<Row>(sql`select commerce.anonymise_expired_documents(${storeId}::uuid, ${cutoff}::date) as n`);
  const documents = Number(row?.n ?? 0);
  if (files.length === 0) return { documents, filesRemoved: 0, filesLeft: [] };
  if (!storage) return { documents, filesRemoved: 0, filesLeft: files };
  const removed = await storage.remove(files).catch(() => false);
  return removed ? { documents, filesRemoved: files.length, filesLeft: [] } : { documents, filesRemoved: 0, filesLeft: files };
}
