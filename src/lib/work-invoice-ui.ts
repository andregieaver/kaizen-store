import type { z } from "zod";

import type {
  InvoiceEvent,
  InvoiceHeader,
  InvoiceLine,
  InvoiceListFilter,
  InvoiceStatus,
} from "@/server/work-invoices";

import {
  bpToPercent,
  computeLine,
  hundredthsToMinutes,
  minutesToHundredths,
  parseMoneyText,
  parsePercentText,
  parseQuantityText,
  minorToDecimal,
  type LineAmounts,
  type InvoiceTotals,
} from "./work-calc";
import { daysBetween, dueState, isDay, type Day } from "./work-dates";
import { documentLanguage } from "./work-invoice-text";
import { LINE_DESCRIPTION_MAX, NOTES_MAX, REFERENCE_MAX, invoiceInput } from "./work-input";
import { parseDuration } from "./work-time";
import { alignCategory, priceInvoice, type VatContext, type VatLineCategory, type VatNoteKey } from "./work-vat";

/**
 * What the invoice screens do with what is typed and what is shown (docs/work.md 5.2, 7.2 WP6): the draft's
 * lines as rows of text, read into the input `invoiceInput` checks, priced with the same functions the server
 * prices a draft with (so the live totals are the server's preview), merged with what the server has when it
 * changed meanwhile, the credit note's lines, and the list's filters read from its address. Pure and without
 * floating-point money: every amount is minor units, every quantity hundredths, every rate basis points.
 */

// --- The lines of a draft as text ------------------------------------------------------------------------

/** One line as the person edits it: the numbers as typed, so what was typed is never rewritten under them. */
export type LineRow = {
  /** Stable while the page is open; a saved line's is its id, a new one's is its own. */
  key: string;
  /** The line's id once it is saved. */
  id: string | null;
  taskId: string | null;
  assignmentId: string | null;
  /** Empty for a line that has no description yet (stored as "Line item"). */
  description: string;
  unit: "hour" | "unit";
  quantity: string;
  /** Without VAT, in the invoice's currency's major units. */
  price: string;
  /** A percentage. */
  discount: string;
  vatCategory: VatLineCategory;
  /** The quantity was typed or rounded by a person, so logged time no longer rewrites it. */
  quantityManual: boolean;
  /** Minutes of logged time on the line (what the server has). */
  timeMinutes: number;
};

/** A quantity as it is put in its field, without trailing zeros: 1, 1.5, 0.33. */
export function quantityField(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

const UNNAMED = "Line item";

/** A saved line as a row. */
export function rowFromLine(line: InvoiceLine, currency: string): LineRow {
  return {
    key: line.id,
    id: line.id,
    taskId: line.taskId,
    assignmentId: line.assignmentId,
    description: line.description.trim() === UNNAMED ? "" : line.description,
    unit: line.unit,
    quantity: quantityField(line.quantityHundredths),
    price: minorToDecimal(line.unitPriceMinor, currency),
    discount: bpToPercent(line.discountBp),
    vatCategory: line.vatCategory,
    quantityManual: line.quantityManual,
    timeMinutes: line.timeMinutes,
  };
}

/** A new row: one hour or unit at the client's rate (when it has one), no discount, VAT following the client. */
export function blankRow(
  key: string,
  args: { rateMinor: number | null; currency: string; assignmentId: string | null; unit?: "hour" | "unit" },
): LineRow {
  return {
    key,
    id: null,
    taskId: null,
    assignmentId: args.assignmentId,
    description: "",
    unit: args.unit ?? "hour",
    quantity: "1",
    price: args.rateMinor === null ? "" : minorToDecimal(args.rateMinor, args.currency),
    discount: "0",
    vatCategory: "standard",
    quantityManual: false,
    timeMinutes: 0,
  };
}

export type LineErrors = Partial<Record<"description" | "quantity" | "price" | "discount", string>>;

/** The quantity typed on a line, in hundredths: a number ("1,5") or, for hours, a time ("1h30", "90m"). */
export function readQuantity(text: string, unit: "hour" | "unit"): number | null {
  const plain = parseQuantityText(text);
  if (plain !== null) return plain;
  if (unit !== "hour") return null;
  const time = parseDuration(text, { bare: "hours", max: hundredthsToMinutes(10_000_000) });
  return time.ok ? minutesToHundredths(time.minutes) : null;
}

export const QUANTITY_MESSAGE = {
  hour: "Enter the hours, such as 1.5 or 1h30.",
  unit: "Enter a quantity, such as 3 or 1.5.",
} as const;

/** What a row says when read: the numbers, or a message for each field that cannot be read. */
export function readRow(
  row: LineRow,
  currency: string,
):
  | { ok: true; quantityHundredths: number; unitPriceMinor: number; discountBp: number }
  | { ok: false; errors: LineErrors } {
  const errors: LineErrors = {};
  if (row.description.trim().length > LINE_DESCRIPTION_MAX)
    errors.description = `A description is at most ${LINE_DESCRIPTION_MAX} characters.`;
  const quantity = row.quantity.trim() === "" ? null : readQuantity(row.quantity, row.unit);
  if (quantity === null) errors.quantity = QUANTITY_MESSAGE[row.unit];
  // A price left empty is 0: a new line starts so, and an invoice with a line at 0 is warned about before issuing.
  const price = row.price.trim() === "" ? 0 : parseMoneyText(row.price, currency);
  if (price === null) errors.price = "Enter a price without VAT, such as 950 or 950,50.";
  const discount = row.discount.trim() === "" ? 0 : parsePercentText(row.discount);
  if (discount === null) errors.discount = "A discount is 0 to 100 %.";
  if (quantity === null || price === null || discount === null) return { ok: false, errors };
  if (errors.description) return { ok: false, errors };
  return { ok: true, quantityHundredths: quantity, unitPriceMinor: price, discountBp: discount };
}

/**
 * A row's content as what it means, without its key and what only the server knows: "950" and "950.00" are the
 * same price, and " a " is "a". What "the same line" means when the server's copy is compared with the person's.
 */
function meaning(row: LineRow, currency: string) {
  const quantity = readQuantity(row.quantity, row.unit);
  const price = row.price.trim() === "" ? 0 : parseMoneyText(row.price, currency);
  const discount = row.discount.trim() === "" ? 0 : parsePercentText(row.discount);
  return {
    description: row.description.trim(),
    unit: row.unit,
    quantity: quantity ?? row.quantity,
    price: price ?? row.price,
    discount: discount ?? row.discount,
    vatCategory: row.vatCategory,
    quantityManual: row.quantityManual,
    assignmentId: row.assignmentId,
  };
}

type Meaning = ReturnType<typeof meaning>;

/** Whether two lists are the same lines in the same order (ids and what the lines mean). */
export function sameRows(a: readonly LineRow[], b: readonly LineRow[], currency: string): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, i) =>
        row.id === b[i].id && JSON.stringify(meaning(row, currency)) === JSON.stringify(meaning(b[i], currency)),
    )
  );
}

/** Moves a row up (-1) or down (+1); the same list when it cannot move. */
export function moveRow(rows: readonly LineRow[], key: string, delta: number): LineRow[] {
  const from = rows.findIndex((row) => row.key === key);
  if (from < 0) return [...rows];
  const to = Math.max(0, Math.min(rows.length - 1, from + delta));
  if (to === from) return [...rows];
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Puts `key` where `overKey` is (a drag ended there). */
export function dropRow(rows: readonly LineRow[], key: string, overKey: string): LineRow[] {
  const from = rows.findIndex((row) => row.key === key);
  const to = rows.findIndex((row) => row.key === overKey);
  return from < 0 || to < 0 || from === to ? [...rows] : moveRow(rows, key, to - from);
}

/**
 * The person's rows and what the server now has, when the server's changed while the page was open (a task was
 * added, a timer stopped, time was attached): a field the person has not touched since the last save takes the
 * server's value, one they changed keeps theirs, a line the server made appears, and a line that is gone on the
 * server goes unless it was edited (then it is kept as a new line and saved again). `base` is the rows as last
 * saved. A field that only differs in how it is written ("950" and "950.00") keeps what the person typed.
 */
export function mergeServerRows(
  local: readonly LineRow[],
  base: readonly LineRow[],
  server: readonly LineRow[],
  currency: string,
): LineRow[] {
  const baseById = new Map(base.filter((r) => r.id).map((r) => [r.id as string, r]));
  const serverById = new Map(server.filter((r) => r.id).map((r) => [r.id as string, r]));
  const localIds = new Set(local.filter((r) => r.id).map((r) => r.id as string));
  const fields = [
    "description",
    "unit",
    "quantity",
    "price",
    "discount",
    "vatCategory",
    "quantityManual",
    "assignmentId",
  ] as const;

  const merged: LineRow[] = [];
  for (const row of local) {
    if (!row.id) {
      merged.push(row);
      continue;
    }
    const theirs = serverById.get(row.id);
    const before = baseById.get(row.id);
    if (!theirs) {
      const untouched = before && JSON.stringify(meaning(row, currency)) === JSON.stringify(meaning(before, currency));
      if (untouched) continue;
      merged.push({ ...row, id: null, taskId: null, timeMinutes: 0 });
      continue;
    }
    const mine = meaning(row, currency);
    const was = before ? meaning(before, currency) : null;
    const now = meaning(theirs, currency);
    const next: LineRow = { ...row, taskId: theirs.taskId, timeMinutes: theirs.timeMinutes };
    for (const field of fields) {
      const edited =
        was !== null && JSON.stringify(mine[field as keyof Meaning]) !== JSON.stringify(was[field as keyof Meaning]);
      const differs = JSON.stringify(mine[field as keyof Meaning]) !== JSON.stringify(now[field as keyof Meaning]);
      if (!edited && differs) (next as Record<string, unknown>)[field] = theirs[field];
    }
    merged.push(next);
  }

  const arrived = server.filter((r) => r.id && !localIds.has(r.id) && !baseById.has(r.id));
  const reordered =
    local
      .filter((r) => r.id && baseById.has(r.id))
      .map((r) => r.id)
      .join() !==
    base
      .filter((r) => r.id && localIds.has(r.id))
      .map((r) => r.id)
      .join();
  if (reordered) return [...merged, ...arrived];

  // Nobody reordered: the server's order stands, and lines not saved yet stay at the end.
  const byId = new Map(merged.filter((r) => r.id).map((r) => [r.id as string, r]));
  const ordered: LineRow[] = [];
  for (const row of server) {
    const own = row.id ? byId.get(row.id) : undefined;
    if (own) ordered.push(own);
    else if (row.id && arrived.includes(row)) ordered.push(row);
  }
  for (const row of merged) if (!ordered.includes(row)) ordered.push(row);
  return ordered;
}

// --- The header of a draft as text -----------------------------------------------------------------------

export type DraftHeaderValues = {
  currency: string;
  paymentDays: string;
  serviceFrom: string;
  serviceTo: string;
  reference: string;
  notes: string;
};

export const headerFromInvoice = (
  invoice: Pick<InvoiceHeader, "currency" | "paymentDays" | "serviceFrom" | "serviceTo" | "reference" | "notes">,
): DraftHeaderValues => ({
  currency: invoice.currency,
  paymentDays: invoice.paymentDays === null ? "" : String(invoice.paymentDays),
  serviceFrom: invoice.serviceFrom ?? "",
  serviceTo: invoice.serviceTo ?? "",
  reference: invoice.reference ?? "",
  notes: invoice.notes ?? "",
});

export type HeaderErrors = Partial<Record<keyof DraftHeaderValues, string>>;

export type DraftProblems = { header: HeaderErrors; lines: Record<string, LineErrors>; general: string[] };

/** What `saveDraftInvoiceAction` takes. */
export type DraftInput = z.input<typeof invoiceInput>;

export type DraftRead = { ok: true; input: DraftInput; key: string } | { ok: false; problems: DraftProblems };

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

export const hasDraftProblems = (problems: DraftProblems): boolean =>
  Object.keys(problems.header).length > 0 || Object.keys(problems.lines).length > 0 || problems.general.length > 0;

/** How many things the person must fix before the draft can be saved. */
export const problemCount = (problems: DraftProblems): number =>
  Object.keys(problems.header).length +
  Object.values(problems.lines).reduce((sum, errors) => sum + Object.keys(errors).length, 0) +
  problems.general.length;

// --- The live totals -----------------------------------------------------------------------------------------

export type PricedRow = LineAmounts & { vatBp: number; vatCategory: VatLineCategory; readable: boolean };

export type DraftPreview = { lines: PricedRow[]; totals: InvoiceTotals; noteKeys: VatNoteKey[] };

/**
 * The rows as the server prices a draft (`priceInvoice` with the line categories aligned to the client's VAT
 * treatment): the same functions, so the total the person sees is the one the database will issue. A field that
 * cannot be read counts as 0 until it is fixed. `extra` adds hundredths to a row's quantity (a running clock's
 * time not yet on the line). Null when the sums are too large to be exact.
 */
export function previewRows(
  ctx: VatContext,
  currency: string,
  rows: readonly LineRow[],
  extra: ReadonlyMap<string, number> = new Map(),
): DraftPreview | null {
  const read = rows.map((row) => {
    const value = readRow(row, currency);
    const extraQuantity = extra.get(row.key) ?? 0;
    return value.ok
      ? {
          readable: true,
          quantityHundredths: Math.min(10_000_000, value.quantityHundredths + extraQuantity),
          unitPriceMinor: value.unitPriceMinor,
          discountBp: value.discountBp,
        }
      : { readable: false, quantityHundredths: 0, unitPriceMinor: 0, discountBp: 0 };
  });
  try {
    const priced = priceInvoice(
      ctx,
      read.map((line, index) => ({
        quantityHundredths: line.quantityHundredths,
        unitPriceMinor: line.unitPriceMinor,
        discountBp: line.discountBp,
        category: alignCategory(ctx, rows[index].vatCategory),
      })),
    );
    return {
      lines: priced.lines.map((line, index) => ({
        grossMinor: line.grossMinor,
        discountMinor: line.discountMinor,
        exclMinor: line.exclMinor,
        vatMinor: line.vatMinor,
        inclMinor: line.inclMinor,
        vatBp: line.vatBp,
        vatCategory: line.vatCategory,
        readable: read[index].readable,
      })),
      totals: priced.totals,
      noteKeys: priced.noteKeys,
    };
  } catch {
    return null;
  }
}

/**
 * Hundredths a running clock adds to lines paired with its task, so the totals tick while it runs: only for a
 * line whose hours logged time sets (a task's line, an hourly quantity nobody typed, not a fixed fee).
 * `liveMinutes` is what the clock and a stop being logged add for an assignment and task.
 */
export function liveExtra(
  rows: readonly LineRow[],
  liveMinutes: (assignmentId: string, taskId: string) => number,
  fixedFeeAssignments: ReadonlySet<string>,
): Map<string, number> {
  const extra = new Map<string, number>();
  for (const row of rows) {
    if (!row.taskId || !row.assignmentId || row.quantityManual || row.unit !== "hour") continue;
    if (fixedFeeAssignments.has(row.assignmentId)) continue;
    const minutes = liveMinutes(row.assignmentId, row.taskId);
    if (minutes <= 0) continue;
    const delta = minutesToHundredths(row.timeMinutes + minutes) - minutesToHundredths(row.timeMinutes);
    if (delta > 0) extra.set(row.key, delta);
  }
  return extra;
}

// --- Credit notes ----------------------------------------------------------------------------------------------

type CreditedLine = {
  lineId: string;
  quantityHundredths: number;
  exclMinor: number;
  vatMinor: number;
  inclMinor: number;
};

/** How much of a line the credit notes so far have taken, in quantity and in money. */
export function creditedSoFar(
  notes: readonly { lines: readonly CreditedLine[] }[],
  lineId: string,
): { quantityHundredths: number; exclMinor: number; vatMinor: number; inclMinor: number } {
  const total = { quantityHundredths: 0, exclMinor: 0, vatMinor: 0, inclMinor: 0 };
  for (const note of notes) {
    for (const line of note.lines) {
      if (line.lineId !== lineId) continue;
      total.quantityHundredths += line.quantityHundredths;
      total.exclMinor += line.exclMinor;
      total.vatMinor += line.vatMinor;
      total.inclMinor += line.inclMinor;
    }
  }
  return total;
}

/** What is left of a line to credit: its quantity, and the amounts still on it. */
export function creditableOf(line: InvoiceLine, notes: readonly { lines: readonly CreditedLine[] }[]) {
  const taken = creditedSoFar(notes, line.id);
  return {
    quantityHundredths: Math.max(0, line.quantityHundredths - taken.quantityHundredths),
    exclMinor: Math.max(0, line.exclMinor - taken.exclMinor),
    vatMinor: Math.max(0, line.vatMinor - taken.vatMinor),
    inclMinor: Math.max(0, line.inclMinor - taken.inclMinor),
  };
}

/**
 * What crediting `quantityHundredths` of a line comes to: all that is left of its amounts when it is the last
 * part (the database gives the last part exactly what is left, so the notes add up to the invoice), else the
 * line's own formula at its frozen price, discount and VAT rate.
 */
export function creditAmounts(
  line: InvoiceLine,
  notes: readonly { lines: readonly CreditedLine[] }[],
  quantityHundredths: number,
): { exclMinor: number; vatMinor: number; inclMinor: number } {
  const left = creditableOf(line, notes);
  if (quantityHundredths >= left.quantityHundredths) return left;
  const amounts = computeLine({
    quantityHundredths,
    unitPriceMinor: line.unitPriceMinor,
    discountBp: line.discountBp,
    vatBp: line.vatBp,
    vatCategory: line.vatCategory,
  });
  return { exclMinor: amounts.exclMinor, vatMinor: amounts.vatMinor, inclMinor: amounts.inclMinor };
}

export type CreditChoice = { lineId: string; quantity: string };

/** The lines and quantities of a partial credit note as the action takes them, or a message per line. */
export function readCreditLines(
  lines: readonly InvoiceLine[],
  notes: readonly { lines: readonly CreditedLine[] }[],
  choices: readonly CreditChoice[],
):
  | { ok: true; lines: { lineId: string; quantityHundredths: number }[]; inclMinor: number }
  | { ok: false; errors: Record<string, string>; general: string | null } {
  const errors: Record<string, string> = {};
  const picked: { lineId: string; quantityHundredths: number }[] = [];
  let inclMinor = 0;
  for (const choice of choices) {
    const line = lines.find((l) => l.id === choice.lineId);
    if (!line || choice.quantity.trim() === "") continue;
    const quantity = readQuantity(choice.quantity, line.unit);
    const left = creditableOf(line, notes).quantityHundredths;
    if (quantity === null) errors[choice.lineId] = QUANTITY_MESSAGE[line.unit];
    else if (quantity === 0) continue;
    else if (quantity > left) errors[choice.lineId] = `At most ${quantityField(left)} is left to credit.`;
    else {
      picked.push({ lineId: line.id, quantityHundredths: quantity });
      inclMinor += creditAmounts(line, notes, quantity).inclMinor;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors, general: null };
  if (picked.length === 0) return { ok: false, errors, general: "Enter a quantity for at least one line." };
  return { ok: true, lines: picked, inclMinor };
}

/** What has been paid beyond what is still owed once a credit note of `creditMinor` is issued: the most that can be paid back. */
export function refundable(
  amounts: { totalMinor: number; paidMinor: number; creditedMinor: number },
  creditMinor: number,
): number {
  const owed = Math.max(0, amounts.totalMinor - amounts.creditedMinor - creditMinor);
  return Math.max(0, amounts.paidMinor - owed);
}

// --- Payments --------------------------------------------------------------------------------------------------

/** The message for an amount typed to record as received, or null when it is fine. */
export function paymentAmountProblem(
  text: string,
  currency: string,
  outstandingMinor: number,
): { minor: number | null; message: string | null } {
  const minor = text.trim() === "" ? null : parseMoneyText(text, currency);
  if (minor === null || minor <= 0)
    return { minor: null, message: "Enter the amount received, such as 1250 or 1250,50." };
  if (minor > outstandingMinor) return { minor: null, message: "That is more than what is outstanding." };
  return { minor, message: null };
}

// --- The list ----------------------------------------------------------------------------------------------------

export const INVOICE_SHOWS = ["all", "drafts", "sent", "overdue", "paid", "void"] as const;
export type InvoiceShow = (typeof INVOICE_SHOWS)[number];

export const SHOW_LABELS: Record<InvoiceShow, string> = {
  all: "All",
  drafts: "Drafts",
  sent: "Issued",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

export type InvoiceListParams = {
  show: InvoiceShow;
  clientId: string;
  from: string;
  to: string;
  q: string;
  page: number;
};

type Query = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

/** The list's filters as the address holds them; anything unreadable is left out. */
export function parseInvoiceListParams(query: Query): InvoiceListParams {
  const show = first(query.show);
  const day = (value: string) => (isDay(value) ? value : "");
  const page = /^\d+$/.test(first(query.page)) ? Math.max(1, Number(first(query.page))) : 1;
  return {
    show: (INVOICE_SHOWS as readonly string[]).includes(show) ? (show as InvoiceShow) : "all",
    clientId: first(query.client),
    from: day(first(query.from)),
    to: day(first(query.to)),
    q: first(query.q).trim().slice(0, 100),
    page,
  };
}

/** What the reader is asked for. */
export function invoiceListFilter(params: InvoiceListParams, pageSize: number): InvoiceListFilter {
  const status: Record<InvoiceShow, InvoiceStatus | undefined> = {
    all: undefined,
    drafts: "draft",
    sent: "sent",
    overdue: undefined,
    paid: "paid",
    void: "void",
  };
  return {
    status: status[params.show],
    overdue: params.show === "overdue" ? true : undefined,
    clientId: params.clientId || undefined,
    issuedFrom: params.from || undefined,
    issuedTo: params.to || undefined,
    search: params.q || undefined,
    page: params.page,
    pageSize,
  };
}

/** The address' query for the filters, with `change` applied; what is at its default is left out. */
export function invoiceListQuery(params: InvoiceListParams, change: Partial<InvoiceListParams> = {}): string {
  const next = { ...params, ...change };
  if (!("page" in change)) next.page = 1;
  const search = new URLSearchParams();
  if (next.show !== "all") search.set("show", next.show);
  if (next.clientId) search.set("client", next.clientId);
  if (next.from) search.set("from", next.from);
  if (next.to) search.set("to", next.to);
  if (next.q) search.set("q", next.q);
  if (next.page > 1) search.set("page", String(next.page));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const hasListFilters = (params: InvoiceListParams): boolean =>
  Boolean(params.clientId || params.from || params.to || params.q);

// --- How an invoice reads ----------------------------------------------------------------------------------------

export type StatusView = { label: string; tone: "neutral" | "good" | "warn" | "bad"; note: string | null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The chip and the words next to it: draft, issued (with overdue and due soon), paid, void. */
export function statusView(invoice: { status: InvoiceStatus; dueOn: Day | null; today: Day }): StatusView {
  switch (invoice.status) {
    case "draft":
      return { label: "Draft", tone: "neutral", note: null };
    case "paid":
      return { label: "Paid", tone: "good", note: null };
    case "void":
      return { label: "Void", tone: "neutral", note: "Fully credited" };
    case "sent": {
      if (!invoice.dueOn) return { label: "Issued", tone: "neutral", note: null };
      const state = dueState(invoice.dueOn, invoice.today);
      if (state === "overdue") {
        const late = daysBetween(invoice.dueOn, invoice.today);
        return { label: "Overdue", tone: "bad", note: `${plural(late, "day", "days")} late` };
      }
      if (state === "due_soon") {
        const left = daysBetween(invoice.today, invoice.dueOn);
        return {
          label: "Due soon",
          tone: "warn",
          note: left === 0 ? "Due today" : `Due in ${plural(left, "day", "days")}`,
        };
      }
      return { label: "Issued", tone: "neutral", note: null };
    }
  }
}

const METHOD_LABELS: Record<string, string> = {
  bank: "bank transfer",
  card: "card",
  cash: "cash",
  other: "other",
  stripe: "card online",
  prepaid: "prepaid hours",
};
export const methodLabel = (method: string): string => METHOD_LABELS[method] ?? method;

/** One line of the invoice's history, in words. `money` writes an amount in a currency. */
export function eventText(event: InvoiceEvent, money: (minor: number, currency: string) => string): string {
  const d = event.data;
  const amount = () => {
    const minor = Number(d.amount_minor);
    const currency = typeof d.currency === "string" ? d.currency : "";
    return Number.isSafeInteger(minor) && currency ? money(Math.abs(minor), currency) : "an amount";
  };
  const money2 = (value: unknown, currency: unknown) =>
    typeof value === "number" && typeof currency === "string" && Number.isSafeInteger(value)
      ? money(value, currency)
      : null;
  switch (event.type) {
    case "invoice.created":
      return "Draft created";
    case "invoice.issued":
      return `Issued as ${String(d.document_number ?? "a numbered invoice")}`;
    case "invoice.paid":
      return "Paid in full";
    case "invoice.reopened":
      return "Reopened: a payment was taken back";
    case "invoice.credited": {
      const total = money2(d.total_minor, d.currency);
      return `Credit note ${String(d.document_number ?? "")} issued${total ? ` for ${total}` : ""}`.replace("  ", " ");
    }
    case "invoice.emailed":
      return typeof d.to === "string" ? `Emailed to ${d.to}` : "Emailed";
    case "payment.recorded":
      return `Payment of ${amount()} received${typeof d.method === "string" ? ` by ${methodLabel(d.method)}` : ""}`;
    case "payment.reversed":
      return `Payment of ${amount()} reversed`;
    case "payment.refunded":
      return `${amount()} paid back`;
    default:
      return event.type;
  }
}

// --- VAT in words -------------------------------------------------------------------------------------------------

/** What a line's category is called where the person chooses it. */
export const VAT_CATEGORY_LABELS: Record<VatLineCategory, string> = {
  standard: "Standard (follows the client)",
  exempt: "Exempt",
  reverse_charge: "Reverse charge",
  outside_scope: "Outside the scope of VAT",
};

/** A line of the VAT summary: "VAT 25 %", "Reverse charge (0 %)". */
export function vatGroupLabel(group: { category: VatLineCategory; vatBp: number }): string {
  switch (group.category) {
    case "standard":
      return group.vatBp === 0 ? "No VAT" : `VAT ${bpToPercent(group.vatBp)} %`;
    case "exempt":
      return "Exempt (0 %)";
    case "reverse_charge":
      return "Reverse charge (0 %)";
    case "outside_scope":
      return "Outside the scope of VAT (0 %)";
  }
}

/** The statutory notes a draft will carry, for the person to see before issuing. */
export const VAT_NOTE_LABELS: Record<VatNoteKey, string> = {
  not_registered: "The invoice will say the seller is not registered for VAT.",
  reverse_charge: "The invoice will carry the reverse charge note: the buyer accounts for the VAT.",
  outside_scope: "The invoice will say it is outside the scope of VAT.",
  exempt: "The invoice will say the services are exempt from VAT.",
};

// --- Issuing -----------------------------------------------------------------------------------------------------

/** An exchange rate as typed ("11,5"), as the text the server takes; null when it is not a usable rate. */
export function readFxRate(text: string): string | null {
  const cleaned = text.trim().replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{1,8}))?$/.exec(cleaned);
  return match && Number(cleaned) > 0 ? cleaned : null;
}

/** Where to go to fix a problem of the checklist. */
export function problemHref(
  where: "company" | "settings" | "client" | "invoice",
  args: { storeSlug: string; clientId: string },
): { href: string; label: string } {
  const base = `/admin/${args.storeSlug}`;
  switch (where) {
    case "company":
      return { href: `${base}/settings/company`, label: "Open the Company page" };
    case "settings":
      return { href: `${base}/settings/work`, label: "Open Work settings" };
    case "client":
      return { href: `${base}/work/clients/${args.clientId}`, label: "Open the client" };
    case "invoice":
      return { href: "#invoice-lines", label: "Go to the lines" };
  }
}

const LANGUAGE_NAMES = { nb: "Norwegian", sv: "Swedish", da: "Danish", en: "English" } as const;

/** The language a document is written in, by name. */
export const languageName = (locale: string | null | undefined): string => LANGUAGE_NAMES[documentLanguage(locale)];
