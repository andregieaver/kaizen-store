"use server";

import { refresh } from "next/cache";

import type { z } from "zod";

import type { invoiceDraftInput, invoiceInput, recordPaymentInput, reversePaymentInput } from "@/lib/work-input";
import { audit, type Membership } from "@/server/auth";
import { checkPermission, memberCan } from "@/server/permissions";
import { problem, type WorkResult } from "@/server/work-errors";
import {
  createDraftInvoice,
  creditInvoice,
  deleteDraft,
  generateLinesFromTime,
  invoiceReadiness,
  issueInvoice,
  recordPayment,
  releaseTimeFromDrafts,
  reversePayment,
  saveDraft,
  saveDraftHeader,
  saveLines,
  type CreditInvoiceRequest,
  type InvoiceReadiness,
  type InvoiceResult,
  type IssueInvoiceRequest,
} from "@/server/work-invoices";
import { inWorkLang } from "@/lib/work-text";
import { actionAdminLang } from "@/server/admin-request-lang";

/**
 * Work's actions for invoices (docs/work.md 7.2 WP4): create a draft, save it and its lines, make
 * lines from time, issue, credit, record and reverse payments, delete a draft. Each is bound to the
 * store's slug as its first argument and asks `checkPermission()` itself (a layout's check does not stop
 * a page or an action running), then hands what the browser sent to the server function, which checks
 * it again with the shared schemas: amounts and totals are never accepted from a browser.
 *
 * Owners and admins may do everything except crediting an invoice, which only an owner does (4.9).
 * The document's own history (`work_events`) is written by the database and the server functions; the
 * audit log gets what has legal or money weight: issuing, crediting, reversing a payment, deleting a
 * draft. Work's pages are read per request and nothing is cached, so `refresh()` is all that is needed.
 * They answer `{ ok: true, … }` or `{ ok: false, problems }` (a failure may carry a `code`, such as
 * `date_before_previous`, which the person can confirm).
 */

const OFF = "Work is switched off for this store, or your role has no access to it.";

/** The membership, for a store that has Work on. */
async function workMember(storeSlug: string): Promise<Membership | null> {
  const member = await checkPermission(storeSlug, "settings:write");
  return member?.store.workOn ? member : null;
}

/** Runs a change for a member of a store with Work on, and refreshes the page when it worked. */
async function change<T extends object>(
  storeSlug: string,
  run: (member: Membership) => Promise<InvoiceResult<T>>,
): Promise<InvoiceResult<T>> {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  const result = await run(member);
  if (result.ok) refresh();
  return result;
}

// --- Drafts -------------------------------------------------------------------------------------------

/** Starts a draft for a client, for one of its assignments (one draft each) or on its own. */
export async function createDraftInvoiceAction(storeSlug: string, input: Partial<z.input<typeof invoiceDraftInput>>) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, (member) => createDraftInvoice(member, input));
})(),
    lang,
  );
}

/** The editor's save: the header and every line, in order. */
export async function saveDraftInvoiceAction(
  storeSlug: string,
  invoiceId: string,
  input: z.input<typeof invoiceInput>,
) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, (member) => saveDraft(member, invoiceId, input));
})(),
    lang,
  );
}

/** Saves only the lines of a draft, in the browser's order. */
export async function saveInvoiceLinesAction(
  storeSlug: string,
  invoiceId: string,
  lines: z.input<typeof invoiceInput>["lines"],
) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, (member) => saveLines(member, invoiceId, lines));
})(),
    lang,
  );
}

/** Saves only a draft's header: currency, payment terms, period, notes, reference. */
export async function saveInvoiceHeaderAction(
  storeSlug: string,
  invoiceId: string,
  input: Partial<z.input<typeof invoiceDraftInput>>,
) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, (member) => saveDraftHeader(member, invoiceId, input));
})(),
    lang,
  );
}

/** Makes lines from unbilled time (the assignment's, or the client's chosen ones) and attaches it to them. */
export async function generateLinesFromTimeAction(
  storeSlug: string,
  invoiceId: string,
  options: { assignmentIds?: string[] | null; from?: string | null; to?: string | null } = {},
) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, (member) => generateLinesFromTime(member, invoiceId, options));
})(),
    lang,
  );
}

/** Takes logged time off the draft lines it is on (so it can be changed, deleted or billed elsewhere). */
export async function releaseTimeFromInvoiceAction(storeSlug: string, entryIds: string[]) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, (member) => releaseTimeFromDrafts(member, entryIds));
})(),
    lang,
  );
}

/** The checklist before issuing, for the panel (the exchange rate typed so far changes it). Nothing is written. */
export async function invoiceReadinessAction(
  storeSlug: string,
  invoiceId: string,
  fxRate: string | null = null,
): Promise<WorkResult<{ readiness: InvoiceReadiness | null }>> {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  return { ok: true, readiness: await invoiceReadiness(member.store.id, invoiceId, { fxRate }) };
})(),
    lang,
  );
}

/** Deletes a draft: it never used a number, and its assignment, tasks and time stay. */
export async function deleteDraftInvoiceAction(storeSlug: string, invoiceId: string) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, async (member) => {
    const result = await deleteDraft(member, invoiceId);
    if (result.ok) await audit(member.account.id, member.store.id, "work.invoice.draft_deleted", { invoiceId });
    return result;
  });
})(),
    lang,
  );
}

// --- Issuing, crediting ---------------------------------------------------------------------------------

/** Issues a draft: the next gap-free number, frozen amounts, seller and buyer snapshots. */
export async function issueInvoiceAction(storeSlug: string, input: IssueInvoiceRequest) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, async (member) => {
    const result = await issueInvoice(member, input);
    if (result.ok) {
      await audit(member.account.id, member.store.id, "work.invoice.issued", {
        invoiceId: result.invoice.invoiceId,
        documentNumber: result.invoice.documentNumber,
        totalMinor: result.invoice.totalMinor,
        currency: result.invoice.currency,
      });
    }
    return result;
  });
})(),
    lang,
  );
}

/** Credits an invoice, whole or in part, optionally recording the refund. Owners only (4.9). */
export async function creditInvoiceAction(storeSlug: string, input: CreditInvoiceRequest) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, async (member) => {
    if (!memberCan(member, "owner")) return problem("Only an owner can credit an invoice.");
    const result = await creditInvoice(member, input);
    if (result.ok) {
      await audit(member.account.id, member.store.id, "work.invoice.credited", {
        invoiceId: input.invoiceId,
        creditNote: result.creditNote.documentNumber,
        totalMinor: result.creditNote.totalMinor,
        voided: result.creditNote.voided,
        refundedMinor: result.creditNote.refundedMinor,
      });
    }
    return result;
  });
})(),
    lang,
  );
}

// --- Payments ---------------------------------------------------------------------------------------------

/** Records a payment received by hand, possibly a part of the total. */
export async function recordPaymentAction(storeSlug: string, input: z.input<typeof recordPaymentInput>) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, (member) => recordPayment(member, input));
})(),
    lang,
  );
}

/** Takes a payment back by adding a reversing row. */
export async function reversePaymentAction(storeSlug: string, input: z.input<typeof reversePaymentInput>) {
  const lang = await actionAdminLang();
  return inWorkLang(
    await (async () => {
  return change(storeSlug, async (member) => {
    const result = await reversePayment(member, input);
    if (result.ok) {
      await audit(member.account.id, member.store.id, "work.payment.reversed", {
        paymentId: input.paymentId,
        reversalId: result.reversalId,
      });
    }
    return result;
  });
})(),
    lang,
  );
}
