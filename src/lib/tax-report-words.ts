/**
 * The VAT, OSS and IOSS page's words in the account's language (D312 A9, D161). The libraries (`tax-classes.ts`, `tax-reconciliation.ts`,
 * `oss-return.ts`, `tax-periods.ts`, `tax-admin.ts`) keep writing English, which the CSV files, the activity log and the AI manager's
 * `vat_report`/`oss_return_data` read; the page says the same facts from the catalogue here, by the codes the libraries keep beside their
 * sentences (a reason, a place, a line's kind and cause, a note's code, a problem's key). Pure. With the English catalogue every function
 * says exactly what the libraries say (`tax-reports.test.ts`).
 *
 * These are the owner's own figures for the owner's accountant. They are not a tax return and Kaizena Flow files nothing.
 */
import { fillWords } from "./admin-fill";
import { taxReportsEn, type TaxReportsMessages } from "./admin-messages/tax-reports.en";
import { knownText } from "./known-words";
import { formatMoney } from "./money";
import type { ClassReason, Place, RegistrationNote, ReturnPart } from "./tax-classes";
import { deadlineOf, deadlineState, type TaxPeriod } from "./tax-periods";
import type { ReconLine } from "./tax-reconciliation";

/** `31 October 2026`, `31. oktober 2026`. */
export function longDateIn(day: string, w: TaxReportsMessages = taxReportsEn): string {
  return fillWords(w.periods.longDate, { day: Number(day.slice(8, 10)), month: w.periods.months[Number(day.slice(5, 7)) - 1] ?? day.slice(5, 7), year: day.slice(0, 4) });
}

/** `Q3 2026` or `September 2026`; `3. kvartal 2026` or `september 2026`. */
export function periodText(period: Pick<TaxPeriod, "kind" | "index" | "year">, w: TaxReportsMessages = taxReportsEn): string {
  return period.kind === "quarter"
    ? fillWords(w.periods.quarter, { n: period.index, year: period.year })
    : fillWords(w.periods.month, { month: w.periods.months[period.index - 1] ?? String(period.index), year: period.year });
}

/** `deadlineSentence()` in the account's words: when the return is due, and that Kaizena Flow does not know what was filed. */
export function deadlineText(period: TaxPeriod, today: string, w: TaxReportsMessages = taxReportsEn): string {
  const values = { period: periodText(period, w), due: longDateIn(deadlineOf(period), w) };
  switch (deadlineState(period, today)) {
    case "in_progress":
      return fillWords(w.periods.inProgress, values);
    case "passed":
      return fillWords(w.periods.passed, values);
    default:
      return fillWords(w.periods.due, values);
  }
}

/** `driftSentence()` in the account's words. Amounts are written as the files write them (`en`), the way an accountant reads them against the CSV. */
export function driftText(drift: { exportedAt: string; currency: string; differenceMinor: number }, w: TaxReportsMessages = taxReportsEn): string {
  return fillWords(w.drift, {
    date: longDateIn(drift.exportedAt.slice(0, 10), w),
    sign: drift.differenceMinor > 0 ? "+" : "-",
    amount: formatMoney(Math.abs(drift.differenceMinor), drift.currency, "en"),
  });
}

/** `reasonText()` in the account's words. */
export const reasonWords = (reason: ClassReason, w: TaxReportsMessages = taxReportsEn): string => w.reasons[reason] ?? reason;

/** `placeLabel()` in the account's words: where a sale is reported, the VAT table's last column. */
export function placeText(result: { place: Place; part: ReturnPart | null; reason: ClassReason }, w: TaxReportsMessages = taxReportsEn): string {
  const p = w.places;
  switch (result.place) {
    case "ioss":
      return p.ioss;
    case "union":
      return fillWords(p.union, { part: result.part ?? "" });
    case "non_union":
      return p.non_union;
    case "national":
      return result.reason === "non_eu_market" ? p.nationalNonEu : p.nationalDomestic;
    default:
      return fillWords(p.none, { label: (p.noneLabels as Record<string, string>)[result.reason] ?? result.reason });
  }
}

/** A registration note's message in the account's words, by its code; one the catalogue does not know stays as written. */
export const noteWords = (note: RegistrationNote, w: TaxReportsMessages = taxReportsEn): string => (w.notes as Record<string, string>)[note.code] ?? note.message;

/**
 * A reconciliation line's label and text in the account's words, by its kind and cause. `main` is the bridge in the main currency, whose
 * end points say how they were converted.
 */
export function lineWords(line: Pick<ReconLine, "kind" | "cause" | "label" | "text">, main: boolean, w: TaxReportsMessages = taxReportsEn): { label: string; text: string } {
  const l = w.recon.lines;
  switch (line.kind) {
    case "finance":
      return main ? l.financeMain : l.finance;
    case "report":
      return main ? l.reportMain : l.report;
    case "no_stored_rate":
      return l.noStoredRate;
    case "rounding":
      return l.rounding;
    case "exchange_rate":
      return l.exchangeRate;
    default:
      return (line.cause && w.recon.causes[line.cause]) || { label: line.label, text: line.text };
  }
}

/** What the export route sent the person back with (`?export=`), in the account's words; null for anything else. */
export function exportProblemText(value: string | string[] | undefined, w: TaxReportsMessages = taxReportsEn): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text && Object.hasOwn(w.exportProblems, text) ? w.exportProblems[text as keyof TaxReportsMessages["exportProblems"]] : null;
}

/** What `ecb-rates.ts` and `tax-rate-overrides.ts` answered, in the account's words (anything not listed stays as written). */
export const rateProblemText = (text: string, w: TaxReportsMessages = taxReportsEn): string => knownText(text, taxReportsEn.problems, w.problems);
