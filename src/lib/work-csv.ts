import { toCsv } from "./dac7";
import {
  billableAmountMinor,
  bpToPercent,
  hundredthsToDecimal,
  minorToDecimal,
  minutesToHundredths,
  type BillingType,
} from "./work-calc";
import type { Day } from "./work-dates";

/**
 * Work's exports (docs/work.md 1.9, 4.5 8, 7.2 WP2): the client period report
 * and the invoice, the invoice register, payments and credit notes as CSV for
 * spreadsheets and the owner's accountant. From Life's `workReportToCsv` and
 * the invoice export's `buildCsv`.
 *
 * Quoting and formula safety are Kaizen's shared `toCsv()` (RFC 4180, and any
 * text a spreadsheet would read as a formula, such as a client called
 * `=HYPERLINK(...)` or a time-entry note starting with `+`, is written as
 * plain text). Amounts are plain decimals with a dot (`1234.50`), written from
 * integers, so they read the same in every spreadsheet locale.
 */

type Cell = string | number | null;

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

/** Rows as CSV text: quoted where needed, formula-safe, CRLF line ends. */
export const buildCsv = (rows: Cell[][]): string => toCsv(rows);

/** The byte order mark Excel needs to open UTF-8 (æ, ø, å) as UTF-8. */
export const withBom = (csv: string): string => `﻿${csv}`;

/**
 * A file name for a download from parts such as a client's name and a period:
 * letters, digits, dots, dashes and underscores only, so nothing typed into a
 * name can break the header it goes in (Life put it in unescaped).
 */
export function csvFileName(...parts: (string | null | undefined)[]): string {
  const base = parts
    .filter((p): p is string => !!p && p.trim() !== "")
    .join("-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${base || "export"}.csv`;
}

// --- Client period report ----------------------------------------------------

export type WorkReportEntry = {
  workDate: Day;
  taskTitle: string | null;
  minutes: number;
  billable: boolean;
  note: string | null;
};

export type WorkReportAssignment = {
  name: string;
  billingType: BillingType;
  periodMinutes: number;
  periodBillableMinutes: number;
  /** Net. */
  periodAmountMinor: number;
  entries: WorkReportEntry[];
};

export type WorkReport = {
  clientName: string;
  periodStart: Day;
  periodEnd: Day;
  currency: string;
  assignments: WorkReportAssignment[];
  totalMinutes: number;
  totalBillableMinutes: number;
  /** Net. */
  totalAmountMinor: number;
};

/**
 * A client's time in a period, per assignment, with net amounts from the
 * rates (Life's report). One deliberate change: a fixed fee is counted once,
 * in the period it was invoiced (`fixedFeeInPeriodMinor`, which the server
 * takes from the issued invoice lines), where Life added the whole fee to
 * every period it showed. An assignment is listed when it has time in the
 * period or a fixed fee counted in it.
 */
export function buildWorkReport(input: {
  client: { name: string; currency: string; defaultHourlyRateMinor: number | null };
  periodStart: Day;
  periodEnd: Day;
  assignments: readonly {
    id: string;
    name: string;
    billingType: BillingType;
    hourlyRateMinor: number | null;
    fixedAmountMinor: number | null;
    fixedFeeInPeriodMinor?: number;
  }[];
  entries: readonly {
    assignmentId: string;
    taskId: string | null;
    workDate: Day;
    minutes: number;
    billable: boolean;
    note: string | null;
  }[];
  taskTitles: ReadonlyMap<string, string>;
}): WorkReport {
  const blocks: WorkReportAssignment[] = [];
  for (const a of input.assignments) {
    const entries = input.entries
      .filter((e) => e.assignmentId === a.id && e.workDate >= input.periodStart && e.workDate <= input.periodEnd)
      .map((e) => ({
        workDate: e.workDate,
        taskTitle: e.taskId ? (input.taskTitles.get(e.taskId) ?? null) : null,
        minutes: e.minutes,
        billable: e.billable,
        note: e.note,
      }))
      .sort((x, y) => (x.workDate < y.workDate ? -1 : x.workDate > y.workDate ? 1 : 0));
    const periodMinutes = entries.reduce((s, e) => s + e.minutes, 0);
    const periodBillableMinutes = entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
    const fixedInPeriod = a.billingType === "fixed_fee" ? (a.fixedFeeInPeriodMinor ?? 0) : 0;
    if (periodMinutes === 0 && fixedInPeriod === 0) continue;
    blocks.push({
      name: a.name,
      billingType: a.billingType,
      periodMinutes,
      periodBillableMinutes,
      periodAmountMinor:
        a.billingType === "fixed_fee" ? fixedInPeriod : billableAmountMinor(a, input.client, periodBillableMinutes),
      entries,
    });
  }
  return {
    clientName: input.client.name,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currency: input.client.currency,
    assignments: blocks,
    totalMinutes: blocks.reduce((s, b) => s + b.periodMinutes, 0),
    totalBillableMinutes: blocks.reduce((s, b) => s + b.periodBillableMinutes, 0),
    totalAmountMinor: blocks.reduce((s, b) => s + b.periodAmountMinor, 0),
  };
}

const hoursOf = (minutes: number): string => hundredthsToDecimal(minutesToHundredths(minutes));

/** The report as CSV: a header block, one row per assignment, every entry, and a total row (Life's layout). */
export function workReportToCsv(report: WorkReport): string {
  const rows: Cell[][] = [
    ["Client", "Period Start", "Period End", "Currency"],
    [report.clientName, report.periodStart, report.periodEnd, report.currency],
    [],
    ["Assignment", "Billing Type", "Period Hours", "Period Billable Hours", "Period Amount"],
  ];
  for (const a of report.assignments) {
    rows.push([
      a.name,
      a.billingType,
      hoursOf(a.periodMinutes),
      hoursOf(a.periodBillableMinutes),
      minorToDecimal(a.periodAmountMinor, report.currency),
    ]);
  }
  rows.push([], ["Date", "Assignment", "Task", "Minutes", "Billable", "Note"]);
  for (const a of report.assignments) {
    for (const e of a.entries) {
      rows.push([e.workDate, a.name, e.taskTitle ?? "", e.minutes, e.billable ? "yes" : "no", e.note ?? ""]);
    }
  }
  rows.push(
    [],
    [
      "Total",
      "",
      hoursOf(report.totalMinutes),
      hoursOf(report.totalBillableMinutes),
      minorToDecimal(report.totalAmountMinor, report.currency),
    ],
  );
  return buildCsv(rows);
}

// --- Invoices, payments, credit notes ----------------------------------------

export type InvoiceCsv = {
  documentNumber: string | null;
  sellerName: string;
  clientName: string;
  clientEmail: string | null;
  issuedOn: Day | null;
  dueOn: Day | null;
  currency: string;
  reference: string | null;
  lines: {
    description: string;
    quantityHundredths: number;
    unitPriceMinor: number;
    discountBp: number;
    vatBp: number;
    exclMinor: number;
    vatMinor: number;
    inclMinor: number;
  }[];
  totals: { subtotalMinor: number; vatMinor: number; totalMinor: number };
};

/** One invoice, its lines and totals (Life's invoice export, with the seller and the VAT amounts per line). */
export function invoiceToCsv(invoice: InvoiceCsv): string {
  const money = (minor: number) => minorToDecimal(minor, invoice.currency);
  const rows: Cell[][] = [
    ["Invoice number", invoice.documentNumber ?? ""],
    ["Seller", invoice.sellerName],
    ["Client", invoice.clientName],
    ["Client email", invoice.clientEmail ?? ""],
    ["Issued", invoice.issuedOn ?? ""],
    ["Due", invoice.dueOn ?? ""],
    ["Currency", invoice.currency],
    ["Reference", invoice.reference ?? ""],
    [],
    ["Description", "Quantity", "Unit price", "Discount %", "VAT %", "Excl", "VAT", "Incl"],
  ];
  for (const l of invoice.lines) {
    rows.push([
      l.description,
      hundredthsToDecimal(l.quantityHundredths),
      money(l.unitPriceMinor),
      bpToPercent(l.discountBp),
      bpToPercent(l.vatBp),
      money(l.exclMinor),
      money(l.vatMinor),
      money(l.inclMinor),
    ]);
  }
  rows.push(
    [],
    ["Subtotal excl. VAT", "", "", "", "", money(invoice.totals.subtotalMinor)],
    ["Total VAT", "", "", "", "", money(invoice.totals.vatMinor)],
    ["Total incl. VAT", "", "", "", "", money(invoice.totals.totalMinor)],
  );
  return buildCsv(rows);
}

/** The invoice register: one row per issued invoice, for the accountant. */
export function invoiceListToCsv(
  invoices: readonly {
    documentNumber: string;
    clientName: string;
    status: string;
    issuedOn: Day;
    dueOn: Day;
    currency: string;
    subtotalMinor: number;
    vatMinor: number;
    totalMinor: number;
    paidMinor: number;
  }[],
): string {
  return buildCsv([
    ["Number", "Client", "Status", "Issued", "Due", "Currency", "Excl VAT", "VAT", "Total", "Paid"],
    ...invoices.map((i) => [
      i.documentNumber,
      i.clientName,
      i.status,
      i.issuedOn,
      i.dueOn,
      i.currency,
      minorToDecimal(i.subtotalMinor, i.currency),
      minorToDecimal(i.vatMinor, i.currency),
      minorToDecimal(i.totalMinor, i.currency),
      minorToDecimal(i.paidMinor, i.currency),
    ]),
  ]);
}

/** Payments, refunds included as negative amounts. */
export function paymentsToCsv(
  payments: readonly {
    receivedOn: Day;
    documentNumber: string;
    clientName: string;
    method: string;
    amountMinor: number;
    currency: string;
    reference: string | null;
  }[],
): string {
  return buildCsv([
    ["Received", "Invoice", "Client", "Method", "Amount", "Currency", "Reference"],
    ...payments.map((p) => [
      p.receivedOn,
      p.documentNumber,
      p.clientName,
      p.method,
      minorToDecimal(p.amountMinor, p.currency),
      p.currency,
      p.reference ?? "",
    ]),
  ]);
}

/** Credit notes, amounts as positive numbers as the documents state them. */
export function creditNotesToCsv(
  notes: readonly {
    documentNumber: string;
    invoiceNumber: string;
    issuedOn: Day;
    clientName: string;
    currency: string;
    subtotalMinor: number;
    vatMinor: number;
    totalMinor: number;
    reason: string | null;
  }[],
): string {
  return buildCsv([
    ["Number", "Invoice", "Issued", "Client", "Currency", "Excl VAT", "VAT", "Total", "Reason"],
    ...notes.map((n) => [
      n.documentNumber,
      n.invoiceNumber,
      n.issuedOn,
      n.clientName,
      n.currency,
      minorToDecimal(n.subtotalMinor, n.currency),
      minorToDecimal(n.vatMinor, n.currency),
      minorToDecimal(n.totalMinor, n.currency),
      n.reason ?? "",
    ]),
  ]);
}
