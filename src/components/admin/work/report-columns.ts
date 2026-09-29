import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/work-time";
import type { ReportFigures } from "@/lib/work-reports";

/**
 * The report's figures as the words the table and the print view show, once, so the two agree: hours as
 * "12h 30m", amounts in their own currency and the reader's locale. Amounts of invoices and credit notes
 * are without VAT and payments and what is owed have VAT, as the money does; the headings say which.
 */
export const REPORT_HEADINGS = {
  hours: "Hours",
  billable: "Billable",
  unbilled: "Unbilled time",
  drafts: "Not yet invoiced",
  invoiced: "Invoiced",
  paid: "Paid",
  outstanding: "Outstanding",
} as const;

/** What each column measures, for the note under the table. */
export const REPORT_NOTES: readonly string[] = [
  "Hours are the time logged on days in the period. Unbilled time is the billable time in the period that no invoice has taken, at your rates, without VAT.",
  "Not yet invoiced is invoice drafts made in the period, without VAT.",
  "Invoiced is invoices issued in the period, without VAT and after credit notes; a fixed fee counts once, in the period it is invoiced. Paid and outstanding are for those invoices, with VAT, as of today.",
  "Amounts are in each client's own currency and are never added across currencies.",
];

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
    credited: f.creditedMinor > 0 ? `after ${money(f.creditedMinor)} credited` : "",
    paid: money(f.paidMinor),
    outstanding: money(f.outstandingMinor),
  };
}
