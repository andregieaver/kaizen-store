import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { siteUrl } from "@/lib/site";

import { cronBearer } from "./cron-auth";
import { PDF_ATTEMPTS } from "./invoices";
import { log } from "./log";
import { col, typedRow } from "./typed-rows";

/**
 * The documents' PDFs made ahead (D159, D695, D795, D807): a job of the five-minute dispatcher (`DISPATCHER_JOBS.documentPdfs`) asks
 * one question, whether an invoice or a credit note waits for its PDF or a signed contract for its sealed PDF, and only then asks the PDF
 * route (`/api/cron/document-pdfs`, which carries Chromium and nothing else calls). A document waits as `pdfJob()` and
 * `signedPdfJob()` pick it: no file yet, fewer than five failures, none in the last five minutes; so one that failed five times is never
 * asked for again until staff press *Try again*. No Chromium here: `invoice-pdf.ts` stays out of this function. When the one-minute
 * tick of bloat review step 3.1 exists, this question becomes its `document-pdfs` queue (step 3.7).
 */

/** The PDF route may take a while on a cold start with Chromium; the dispatcher waits for it, as `triggerLook()` waits for a look. */
const ROUTE_MS = 110_000;
/** As `RETRY_AFTER_MINUTES` in `invoice-pdf.ts` and the contracts' own retry. */
const RETRY_MINUTES = 5;

const WAITING = z.object({ documents: col.bool, seals: col.bool });

/** Whether an invoice or credit note waits for its PDF, or a signed contract for its seal. One statement. `storeId` narrows it, for a test. */
export async function documentPdfsWaiting(now = new Date(), storeId: string | null = null) {
  const at = now.toISOString();
  const mine = (alias: string) => (storeId ? sql`and ${sql.raw(alias)}.store_id = ${storeId}::uuid` : sql``);
  return typedRow(
    WAITING,
    sql`select
      exists (
        select 1 from commerce.invoices i
        left join commerce.document_pdf_state s on s.store_id = i.store_id and s.document_type = 'invoice' and s.document_id = i.id
        where i.pdf_path is null and i.anonymised_at is null ${mine("i")} and coalesce(s.attempts, 0) < ${PDF_ATTEMPTS}
          and (s.last_attempt_at is null or s.last_attempt_at < ${at}::timestamptz - make_interval(mins => ${RETRY_MINUTES}))
      ) or exists (
        select 1 from commerce.credit_notes c
        left join commerce.document_pdf_state s on s.store_id = c.store_id and s.document_type = 'credit_note' and s.document_id = c.id
        where c.pdf_path is null and c.anonymised_at is null ${mine("c")} and coalesce(s.attempts, 0) < ${PDF_ATTEMPTS}
          and (s.last_attempt_at is null or s.last_attempt_at < ${at}::timestamptz - make_interval(mins => ${RETRY_MINUTES}))
      ) as documents,
      exists (
        select 1 from commerce.contracts k
        where k.status = 'signed' and k.signed_pdf_path is null ${mine("k")} and k.signed_pdf_attempts < ${PDF_ATTEMPTS}
          and (k.signed_pdf_tried_at is null or k.signed_pdf_tried_at < ${at}::timestamptz - make_interval(mins => ${RETRY_MINUTES}))
      ) as seals`,
  );
}

/** The dispatcher's run: the PDF route asked only while something waits. */
export async function runDocumentPdfAsk(now = new Date()): Promise<{ documents: boolean; seals: boolean; asked: boolean }> {
  const waiting = await documentPdfsWaiting(now);
  if (!waiting || (!waiting.documents && !waiting.seals)) return { documents: false, seals: false, asked: false };
  return { ...waiting, asked: await askPdfRoute() };
}

async function askPdfRoute(): Promise<boolean> {
  const bearer = await cronBearer();
  if (!bearer) return false;
  try {
    const answer = await fetch(`${siteUrl()}/api/cron/document-pdfs`, {
      method: "POST",
      headers: { authorization: bearer },
      signal: AbortSignal.timeout(ROUTE_MS),
    });
    if (!answer.ok) log("warn", "documents.pdf_ask_failed", { status: answer.status });
    return answer.ok;
  } catch (error) {
    log("warn", "documents.pdf_ask_failed", {}, error);
    return false;
  }
}
