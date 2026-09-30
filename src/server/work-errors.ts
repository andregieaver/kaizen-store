import { z } from "zod";

/**
 * What went wrong in Work, in words for the person using the admin (English,
 * as the whole admin is, docs/work.md 4.8). Shared by every Work server
 * module (`work.ts`, `work-time.ts`, `work-invoices.ts`, …) and their actions.
 *
 * The database's rules raise errors whose message starts with a
 * `work_<thing>.<reason>` code (docs/work.md 4.2a), so what a trigger or a
 * function refused can be told apart from a bug: `workErrorCode()` finds the
 * code in the error (Drizzle wraps the driver's error, so the chain of causes
 * is walked), `workErrorMessage()` words it, and `workProblems()` also knows
 * the few constraints a person can run into (a second draft for an
 * assignment, a row of another store). Anything it does not recognise is not
 * a problem to show but a bug: `workGuard()` lets that propagate.
 */

/** What every Work server function and action returns: the extra fields of a success, or the problems to show. */
export type WorkResult<T extends object = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/** The messages of a failed check, once each, in order (what forms show under the fields). */
export function zodProblems(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.message))];
}

/** A failed result in one line. */
export const problem = (...problems: string[]): { ok: false; problems: string[] } => ({ ok: false, problems });

/**
 * Codes the database raises, with what to tell the person. Codes with a
 * detail after them (`not_ready`, `date_before_previous`) are worded by
 * `workErrorMessage()`, which adds the detail.
 */
export const WORK_ERROR_MESSAGES: Record<string, string> = {
  // Invoices
  "work_invoice.not_found": "This invoice no longer exists.",
  "work_invoice.not_draft": "This invoice has already been issued.",
  "work_invoice.not_ready": "The invoice is not ready to be issued.",
  "work_invoice.total_changed":
    "The total changed while you were issuing the invoice. Check the amounts and try again.",
  "work_invoice.date_in_future": "An invoice cannot be dated in the future.",
  "work_invoice.date_before_previous":
    "The date is earlier than your previous invoice's. Confirm it if you mean to backdate the invoice.",
  "work_invoice.fx_rate_required":
    "Enter the exchange rate: the invoice is in another currency than your country's, and its VAT must also be stated in yours.",
  "work_invoice.draft_only":
    "Only a draft invoice can be changed this way. An issued invoice is issued by issuing a draft.",
  "work_invoice.immutable": "An issued invoice cannot be changed or deleted. Credit it with a credit note instead.",
  "work_invoice.status": "That status change is not allowed for this invoice.",
  "work_invoice.imported_only": "Imported invoices are made by the Kaizen Life import only.",
  "work_invoice.assignment": "The assignment belongs to another client.",
  "work_invoice.recurring": "The repeating invoice belongs to another client.",
  // Credit notes
  "work_credit_note.not_found": "This invoice no longer exists.",
  "work_credit_note.status": "Only an issued invoice that is not already fully credited can be credited.",
  "work_credit_note.lines": "Choose lines that are on the invoice and have something left to credit, each once.",
  "work_credit_note.quantity": "You cannot credit more than what is left of a line.",
  "work_credit_note.nothing_to_credit": "There is nothing left to credit on this invoice.",
  "work_credit_note.date_in_future": "A credit note cannot be dated in the future.",
  "work_credit_note.date_before_invoice": "A credit note cannot be dated before its invoice.",
  "work_credit_note.date_before_previous": "The date is earlier than your previous credit note's.",
  "work_credit_note.currency": "The credit note must be in the invoice's currency.",
  "work_credit_note.too_much": "The credit notes would add up to more than the invoice.",
  // Payments
  "work_payment.draft": "A draft invoice cannot be paid. Issue it first.",
  "work_payment.currency": "The payment must be in the invoice's currency.",
  "work_payment.void": "A credited invoice takes no payments, only refunds.",
  "work_payment.reversal": "A reversal must take back one earlier payment of the same invoice, in full, and only once.",
  // Numbering
  "work_series.prefix": "A prefix is up to 10 letters, digits or . _ / - characters.",
  "work_series.lower": "Numbers already issued are not reused. The next number can only be raised.",
  "work_series.number": "The next number must be 1 or more.",
  "work_series.unknown": "That is not one of your document series.",
  // Time
  "work_time.immutable":
    "This time is on an issued invoice and can no longer be changed or deleted. Credit the invoice to release it.",
  "work_time.billable": "Only billable time can be put on an invoice.",
  "work_time.draft_only": "Time can only be put on the lines of a draft invoice.",
  "work_time.assignment": "This time belongs to another assignment than the invoice line.",
};

/** What a readiness code from `commerce.work_invoice_problems()` means for the owner, and where to fix it. */
export const READINESS_MESSAGES: Record<string, string> = {
  no_lines: "The invoice has no lines.",
  zero_total: "The total is zero. An invoice must be for an amount.",
  seller_name: "Add your legal name under Settings > Company.",
  seller_address: "Add your postal address under Settings > Company.",
  seller_country: "Choose your country under Settings > Company.",
  seller_organisation_number: "Add your organisation number under Settings > Company.",
  seller_vat_number: "Add your VAT number in the Work settings, or say that you are not VAT registered.",
  seller_bank_account: "Add the bank account clients should pay to in the Work settings.",
  buyer_address: "Add the client's billing address.",
  buyer_country: "Choose the client's country.",
  buyer_vat_number: "Add the client's VAT number: it is needed for their VAT treatment.",
  vat_category_mismatch: "A line's VAT category does not fit the client's VAT treatment.",
};

export const readinessMessage = (code: string): string =>
  READINESS_MESSAGES[code.trim()] ?? `Not ready: ${code.trim().replace(/_/g, " ")}.`;

type Failure = { code?: unknown; constraint?: unknown; message?: unknown };

/** The error and what caused it, deepest last (Drizzle wraps the driver's error). */
function chain(error: unknown): Failure[] {
  const found: Failure[] = [];
  for (
    let e = error, depth = 0;
    e && typeof e === "object" && depth < 6;
    e = (e as { cause?: unknown }).cause, depth++
  ) {
    found.push(e as Failure);
  }
  return found;
}

const WORK_CODE = /\b(work_[a-z]+(?:_[a-z]+)?\.[a-z_]+)\b(?::\s*([^\n]*))?/;

/** The `work_*.reason` code a database rule raised, and the detail after it, or null if the error is not one. */
export function workErrorParts(error: unknown): { code: string; detail: string } | null {
  for (const failure of chain(error)) {
    if (typeof failure.message !== "string") continue;
    const match = WORK_CODE.exec(failure.message);
    if (
      match &&
      (match[1] in WORK_ERROR_MESSAGES || /^work_(?:invoice|credit_note|payment|series|time)\./.test(match[1]))
    )
      return { code: match[1], detail: (match[2] ?? "").trim() };
  }
  return null;
}

/** Just the code, e.g. `work_time.immutable`. */
export const workErrorCode = (error: unknown): string | null => workErrorParts(error)?.code ?? null;

/**
 * The person-friendly message for an error a Work rule raised, or null if it
 * is not one. `not_ready` lists what is missing; a backdated date names the
 * previous document's date.
 */
export function workErrorMessage(error: unknown): string | null {
  const parts = workErrorParts(error);
  if (!parts) return null;
  const known = WORK_ERROR_MESSAGES[parts.code];
  if (parts.code === "work_invoice.not_ready") {
    const codes = parts.detail
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    return codes.length > 0 ? `${known} ${codes.map(readinessMessage).join(" ")}` : known;
  }
  if (parts.code.endsWith(".date_before_previous")) {
    const date = /\d{4}-\d{2}-\d{2}/.exec(parts.detail)?.[0];
    return date ? `${known} It is dated ${date}.` : known;
  }
  return known ?? (parts.detail || `That is not allowed (${parts.code}).`);
}

/** The codes of a `work_invoice.not_ready` error, for the readiness panel; empty when it is another error. */
export function notReadyCodes(error: unknown): string[] {
  const parts = workErrorParts(error);
  if (parts?.code !== "work_invoice.not_ready") return [];
  return parts.detail
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Constraints a person can run into, by name (docs/work.md 4.2, 4.2a). */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  work_invoices_one_draft_idx: "This assignment already has a draft invoice.",
  work_invoices_recurring_period_key: "That period has already been invoiced by this repeating invoice.",
  work_invoices_document_number_key: "That invoice number is already in use.",
  work_time_entries_minutes: "Log between 1 minute and 24 hours.",
  work_time_entries_note: "The note is at most 500 characters.",
  work_time_entries_prepaid: "The prepaid time cannot be more than the entry.",
  work_clients_name: "Give the client a name of up to 120 characters.",
  work_assignments_name: "Give the assignment a name of up to 160 characters.",
  work_assignments_dates: "The end comes before the start.",
  work_tasks_title: "Give the task a name of up to 200 characters.",
  work_clients_consumer_domestic: "A private customer is always charged VAT at the domestic rate.",
};

/**
 * What to show for an error from Work's database code: a rule's message, a
 * named constraint, a row that is not in this store (the composite foreign
 * keys refuse it), or a clash of two writers. Null for anything else, which
 * is a bug and must not be shown as if it were the person's mistake.
 */
export function workProblems(error: unknown): string[] | null {
  const message = workErrorMessage(error);
  if (message) return [message];
  for (const failure of chain(error)) {
    const constraint = typeof failure.constraint === "string" ? failure.constraint : null;
    if (constraint && CONSTRAINT_MESSAGES[constraint]) return [CONSTRAINT_MESSAGES[constraint]];
    if (failure.code === "23503") {
      return typeof failure.message === "string" && /update or delete on table/.test(failure.message)
        ? ["This cannot be removed because other records depend on it."]
        : ["That record no longer exists."];
    }
    if (failure.code === "40001" || failure.code === "40P01")
      return ["Someone changed this at the same time. Try again."];
  }
  return null;
}

/** Runs a write, turning what the database's rules refuse into a failed result and letting anything else propagate. */
export async function workGuard<T extends { ok: boolean }>(
  run: () => Promise<T>,
): Promise<T | { ok: false; problems: string[] }> {
  try {
    return await run();
  } catch (error) {
    const problems = workProblems(error);
    if (problems) return { ok: false, problems };
    throw error;
  }
}
