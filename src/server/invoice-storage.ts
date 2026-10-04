import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { DocumentKind } from "@/lib/document-token";
import { publicEnv } from "@/lib/env";
import { supabaseKeyKind } from "@/lib/supabase-key";

/**
 * Where the PDFs of invoices and credit notes are kept (D159, `docs/wave-1b-invoices.md` 3.2 and 4.9): the private `documents` bucket,
 * `{store}/invoices/{id}.pdf` and `{store}/credit-notes/{id}.pdf`, read and written only here, with the secret key. This module
 * does not import Chromium: the emails, the webhook and the order pages reach a stored file through it, while only `invoice-pdf.ts`
 * (and the three routes that render) carry the browser.
 */

export const DOCUMENTS_BUCKET = "documents";

export type DocumentStorage = {
  /** Writes a new file; false when it could not (a file that is already there counts as not written). */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  download(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<boolean>;
};

/** The object path of a document's PDF. */
export const pdfPathOf = (storeId: string, kind: "invoice" | "credit_note", documentId: string): string =>
  `${storeId}/${kind === "invoice" ? "invoices" : "credit-notes"}/${documentId}.pdf`;

/** Whether a path is one a document of this store may have (a stored path is never taken from a request, but it is checked all the same). */
export const isOwnDocumentPath = (storeId: string, path: string): boolean =>
  new RegExp(`^${storeId}/(invoices|credit-notes)/[0-9a-f-]{36}\\.pdf$`).test(path);

/** The bucket behind the secret key, or null when this server has none (no PDF is then stored, and the print page is the fallback). */
export function documentStorage(): DocumentStorage | null {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key || supabaseKeyKind(key) === "publishable") return null;
  let url: string;
  try {
    url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return null;
  }
  const bucket = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(DOCUMENTS_BUCKET);
  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket.upload(path, bytes, { contentType, cacheControl: "0", upsert: false });
      if (error) console.error("[documents] a PDF could not be stored:", error.message);
      return !error;
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return true;
      const { error } = await bucket.remove(paths);
      if (error) console.error("[documents] PDFs could not be removed:", error.message);
      return !error;
    },
  };
}

/**
 * The stored file of a document, never made here: for an email that attaches the PDF when it exists. Null when there is none, the document
 * is anonymised (its file is gone), or storage fails.
 */
export async function readPdf(storeId: string, kind: DocumentKind, documentId: string, deps: { storage?: DocumentStorage | null } = {}): Promise<Uint8Array | null> {
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  if (!storage) return null;
  const table = kind === "invoice" ? sql`commerce.invoices` : sql`commerce.credit_notes`;
  const [doc] = await db().execute<Record<string, unknown>>(sql`
    select pdf_path from ${table} where store_id = ${storeId}::uuid and id = ${documentId}::uuid and anonymised_at is null
  `);
  if (!doc?.pdf_path) return null;
  return storage.download(String(doc.pdf_path)).catch(() => null);
}
