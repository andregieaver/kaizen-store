import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/work-time";
import type { ReportFigures } from "@/lib/work-reports";
import { fillWords } from "@/lib/admin-fill";
import type { workEn } from "@/lib/admin-messages/work.en";
import { workText } from "@/lib/work-text";

/**
 * The report's figures as the words the table and the print view show, once, so the two agree: hours as
 * "12h 30m", amounts in their own currency and the reader's locale. Amounts of invoices and credit notes
 * are without VAT and payments and what is owed have VAT, as the money does; the headings say which.
 */
/** The columns' headings, in the reader's language (D312 A10, `workText()`). */
export function reportHeadings(): Record<keyof typeof workEn.reportColumns.headings, string> {
  return workText().reportColumns.headings;
}

/** What each column measures, for the note under the table. */
export function reportNotes(): readonly string[] {
  return workText().reportColumns.notes;
}

export type ReportCells = {
  hours: string;
  billable: string;
  unbilled: string;
  drafts: string;
  invoiced: string;
  /** "credited 100,00 kr" under the invoiced amount, or empty. */
  credited: string;
  paid: string;
  outstanding: string;
};

export function reportCells(f: ReportFigures, currency: string, locale: string): ReportCells {
  const money = (minor: number) => formatMoney(minor, currency, locale);
  return {
    hours: formatDuration(f.minutes),
    billable: formatDuration(f.billableMinutes),
    unbilled: money(f.unbilledMinor),
    drafts: money(f.draftMinor),
    invoiced: money(f.netInvoicedMinor),
    credited: f.creditedMinor > 0 ? fillWords(workText().reportColumns.credited, { amount: money(f.creditedMinor) }) : "",
    paid: money(f.paidMinor),
    outstanding: money(f.outstandingMinor),
  };
}
