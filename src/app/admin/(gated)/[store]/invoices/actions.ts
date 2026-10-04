"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { checkAgainSentence, sentAgainSentence } from "@/lib/invoice-admin";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { issueMissingCreditNotes, issueWaitingInvoices, retryPdfLater } from "@/server/invoice-issue";
import { sendDocumentAgain } from "@/server/invoice-notices";
import { invoiceCounts } from "@/server/invoices";

/**
 * What staff do on the invoices screens and on an order's Documents card (D159, `docs/wave-1b-invoices.md` 2.3): *Check again*, *Try again*
 * for a PDF that could not be made, and *Send again*. Each is bound to the store's slug by the page and asks `checkPermission(…, "orders:write")`
 * first; every document is looked up by this store's id, so another store's document is "no longer exists". Nothing here makes or changes a
 * document: the database's issuing functions do, and a document is never edited. The settings are in `settings/invoices/actions.ts`.
 */

const failed = (message: string): FormState => ({ status: "error", messages: [message] });
const done = (message: string): FormState => ({ status: "ok", messages: [message] });

const kind = z.enum(["invoice", "credit_note"]);

/**
 * *Check again*: the same job the five-minute run does, for this store, now: the waiting invoices whose cause has been put right are
 * issued, and the credit notes that waited for them. It says how many documents the store has more than before.
 */
export async function checkAgainAction(storeSlug: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return failed(NO_ACCESS);
  const before = await invoiceCounts(member.store.id);
  await issueWaitingInvoices(member.store.id);
  await issueMissingCreditNotes(member.store.id);
  const after = await invoiceCounts(member.store.id);
  refresh();
  return done(checkAgainSentence(Math.max(0, after.invoices - before.invoices), Math.max(0, after.creditNotes - before.creditNotes)));
}

/** *Try again* for a PDF that failed several times: the failures are forgotten and the PDF is made on the next run or download. */
export async function retryPdfAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return failed(NO_ACCESS);
  const input = z.object({ type: kind, id: z.uuid() }).safeParse({ type: String(form.get("type") ?? ""), id: String(form.get("id") ?? "") });
  if (!input.success) return failed("This document no longer exists.");
  const reset = await retryPdfLater(member.store.id, input.data.type, input.data.id);
  refresh();
  return reset ? done("It will be tried again within a few minutes, or when someone opens its PDF.") : failed("This document has no failed tries to forget.");
}

/**
 * Sends an invoice or a credit note to the shopper again, to the order's own address (never one typed here). The order's history says so
 * (`invoice.emailed` / `credit_note.emailed`, written by `sendDocumentAgain()`).
 */
export async function sendDocumentAgainAction(storeSlug: string, type: string, documentId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return failed(NO_ACCESS);
  const input = z.object({ type: kind, id: z.uuid() }).safeParse({ type, id: documentId });
  if (!input.success) return failed("This document no longer exists.");
  const outcome = await sendDocumentAgain(member.store.id, input.data.type, input.data.id, member.account.id);
  const result = sentAgainSentence(input.data.type, outcome);
  refresh();
  return result.ok ? done(result.message) : failed(result.message);
}
