import { isDay } from "./work-dates";
import { NOTES_MAX, REFERENCE_MAX } from "./work-input";
import { invoiceInput } from "./work-input-schema";
import { type DraftHeaderValues, type DraftInput, type DraftProblems, type DraftRead, type LineRow, readRow } from "./work-invoice-ui";

/**
 * The schemas of work-invoice-ui.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; work-invoice-ui.ts imports it as a type alone.
 */

/**
 * The draft as the editor holds it, read into what `saveDraftInvoiceAction` takes, or the messages for what cannot
 * be read. The `key` says what the content is (a new line by its own key, so the ids a save hands out do not make
 * it look changed), and is what the autosave compares.
 */
export function readDraft(args: {
  clientId: string;
  assignmentId: string | null;
  header: DraftHeaderValues;
  rows: readonly LineRow[];
}): DraftRead {
  const { header, rows } = args;
  const problems: DraftProblems = { header: {}, lines: {}, general: [] };
  const currency = header.currency;

  const days = header.paymentDays.trim();
  let paymentDays: number | null = null;
  if (days !== "") {
    paymentDays = /^\d+$/.test(days) ? Number(days) : Number.NaN;
    if (!(paymentDays >= 1 && paymentDays <= 90)) problems.header.paymentDays = "Payment terms are 1 to 90 days.";
  }
  const day = (value: string, field: "serviceFrom" | "serviceTo", message: string) => {
    if (value.trim() === "") return null;
    if (!isDay(value.trim())) problems.header[field] = message;
    return value.trim();
  };
  const serviceFrom = day(header.serviceFrom, "serviceFrom", "Give the start of the period as a date.");
  const serviceTo = day(header.serviceTo, "serviceTo", "Give the end of the period as a date.");
  if (serviceFrom && serviceTo && serviceTo < serviceFrom && !problems.header.serviceTo)
    problems.header.serviceTo = "The period ends before it starts.";
  if (header.reference.trim().length > REFERENCE_MAX)
    problems.header.reference = `A reference is at most ${REFERENCE_MAX} characters.`;
  if (header.notes.trim().length > NOTES_MAX) problems.header.notes = `Notes are at most ${NOTES_MAX} characters.`;

  const lines: DraftInput["lines"] = [];
  for (const row of rows) {
    const read = readRow(row, currency);
    if (!read.ok) {
      problems.lines[row.key] = read.errors;
      continue;
    }
    lines.push({
      id: row.id,
      assignmentId: row.assignmentId,
      taskId: row.taskId,
      description: row.description,
      unit: row.unit,
      quantityHundredths: read.quantityHundredths,
      unitPriceMinor: read.unitPriceMinor,
      discountBp: read.discountBp,
      vatCategory: row.vatCategory,
      quantityManual: row.quantityManual,
    });
  }
  if (Object.keys(problems.header).length > 0 || Object.keys(problems.lines).length > 0) return { ok: false, problems };

  const input: DraftInput = {
    clientId: args.clientId,
    assignmentId: args.assignmentId,
    currency,
    paymentDays,
    serviceFrom,
    serviceTo,
    notes: header.notes,
    reference: header.reference,
    lines,
  };
  const checked = invoiceInput.safeParse(input);
  if (!checked.success) {
    problems.general.push(...new Set(checked.error.issues.map((issue) => issue.message)));
    return { ok: false, problems };
  }
  const key = JSON.stringify({ ...input, lines: lines.map((line, index) => ({ ...line, id: rows[index].key })) });
  return { ok: true, input, key };
}
