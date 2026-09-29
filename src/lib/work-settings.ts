import type { NumberSeriesInput, WorkSettingsInput } from "./work-input";
import { DEFAULT_ESTIMATE_ALERT_MINUTES } from "./work-estimate";
import { DEFAULT_PAYMENT_DAYS } from "./work-dates";
import { workInvoiceReadiness, type ReadinessProblem, type SellerDetails } from "./work-vat";

/**
 * Work settings as the admin shows and saves them (docs/work.md 4.2, 4.4, 4.10,
 * 5.2): what a store that has never saved any looks like, how a submitted
 * form becomes the input `workSettingsInput` checks, what is missing before
 * the first invoice, and how the database's refusals about numbering are put
 * to the owner. Pure, so the form, the action, the page and the tests agree.
 */

/** What a store has before it saves anything: registered for VAT (the safe side: it must then give a number). */
export const DEFAULT_WORK_SETTINGS: WorkSettingsInput = {
  vatRegistered: true,
  vatNumber: null,
  defaultPaymentDays: DEFAULT_PAYMENT_DAYS,
  defaultCurrency: null,
  bankAccount: null,
  bic: null,
  paymentNote: null,
  invoiceFooter: null,
  latePaymentNote: null,
  estimateAlertMinutes: DEFAULT_ESTIMATE_ALERT_MINUTES,
  estimateAlertPopup: true,
  estimateAlertSound: false,
  showTimeNotesToClients: false,
};

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** A whole number typed in a field; anything else becomes -1, which the schema's range message answers. */
const wholeNumber = (text: string): number => (/^\s*\d+\s*$/.test(text) ? Number(text) : -1);

/** The settings form's fields as the input `workSettingsInput` checks. An empty warning field switches warnings off. */
export function settingsFromForm(form: FormData): Record<string, unknown> {
  const registered = form.get("vatRegistered") === "on";
  const alertText = field(form, "estimateAlertMinutes").trim();
  return {
    vatRegistered: registered,
    // A store that is not registered has no VAT number to print.
    vatNumber: registered ? field(form, "vatNumber") : "",
    defaultPaymentDays: wholeNumber(field(form, "defaultPaymentDays")),
    defaultCurrency: field(form, "defaultCurrency") || null,
    bankAccount: field(form, "bankAccount"),
    bic: field(form, "bic"),
    paymentNote: field(form, "paymentNote"),
    invoiceFooter: field(form, "invoiceFooter"),
    latePaymentNote: field(form, "latePaymentNote"),
    estimateAlertMinutes: alertText === "" ? null : wholeNumber(alertText),
    estimateAlertPopup: form.get("estimateAlertPopup") === "on",
    estimateAlertSound: form.get("estimateAlertSound") === "on",
    showTimeNotesToClients: form.get("showTimeNotesToClients") === "on",
  };
}

/** A series form's fields as the input `numberSeriesInput` checks. */
export function seriesFromForm(series: string, form: FormData): Record<string, unknown> {
  return { series, prefix: field(form, "prefix"), nextNumber: wholeNumber(field(form, "nextNumber")) };
}

/** Which settings differ, by name, for the audit log (values are left out: a bank account is not for logs). */
export function changedSettings(before: WorkSettingsInput, after: WorkSettingsInput): string[] {
  return (Object.keys(after) as (keyof WorkSettingsInput)[]).filter((key) => before[key] !== after[key]);
}

// --- Readiness -----------------------------------------------------------------

/**
 * What is still missing before the store can issue its first invoice: the
 * seller's side of `workInvoiceReadiness` (the store's business details, VAT
 * registration and bank account). The client and the lines are checked on
 * the invoice itself. Errors block issuing, warnings are shown.
 */
export function sellerReadiness(seller: SellerDetails): { ready: boolean; problems: ReadinessProblem[] } {
  const { problems } = workInvoiceReadiness({
    seller,
    // A complete stand-in for the buyer and the lines, so only the seller's problems remain.
    buyer: {
      name: "Client",
      address: "Address",
      country: seller.country ?? "NO",
      business: false,
      vatNumber: null,
      vatTreatment: "domestic",
    },
    currency: "EUR",
    sellerHomeCurrency: null,
    fxRate: null,
    lines: [{ description: "Work", exclMinor: 100, vatCategory: "standard", vatBp: seller.vatRegistered ? 2500 : 0 }],
  });
  const own = problems.filter((p) => p.code.startsWith("seller_"));
  return { ready: own.every((p) => p.severity !== "error"), problems: own };
}

// --- Numbering -----------------------------------------------------------------

export const SERIES_TEXT = {
  work_invoice: { title: "Invoices", noun: "invoice", example: "invoice number" },
  work_credit_note: { title: "Credit notes", noun: "credit note", example: "credit note number" },
} as const;

/** The number as it is printed: the prefix, then the number. */
export const documentNumberOf = (prefix: string, number: number): string => `${prefix}${number}`;

const PREFIX_MESSAGE = "A prefix is up to 10 letters, digits or . _ / - characters.";

/** The message a series input would fail with before it reaches the database, or null. */
export const seriesInputProblem = (input: NumberSeriesInput): string | null =>
  input.prefix.length > 10 ? PREFIX_MESSAGE : null;
