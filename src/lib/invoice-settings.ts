/**
 * What an owner may set for invoicing (D159, `docs/wave-1b-invoices.md` 2.3 and 3.1): the switch, the note printed on every
 * invoice and credit note, whether the confirmation email carries the invoice, and the prefix and first number of the two series
 * until the first document of a series is issued. Pure, so the browser and the server check the same rules.
 *
 * Nothing here is legal advice. The prefix rule is the Work series' (up to 10 of `A-Za-z0-9._/-`).
 */

export const FOOTER_NOTE_MAX = 1000;
export const PREFIX_PATTERN = /^[A-Za-z0-9._/-]{0,10}$/;
export const SERIES_NAMES = ["invoice", "credit_note"] as const;
export type SeriesName = (typeof SERIES_NAMES)[number];

/** The prefixes a store's series start with (migration `order_invoices_rules`). */
export const DEFAULT_PREFIX: Record<SeriesName, string> = { invoice: "F-", credit_note: "K-" };

export type InvoiceSettingsForm = { enabled?: unknown; footerNote?: unknown; emailWithConfirmation?: unknown };
export type InvoiceSettingsValues = { enabled: boolean; footerNote: string | null; emailWithConfirmation: boolean };
export type InvoiceSettingsField = "footerNote";

const on = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["on", "true", "1", "yes"].includes(String(value).toLowerCase());
};

/** Control characters other than a line break and a tab are dropped: the note is text only, drawn as text, never as HTML. */
export const cleanNote = (value: string): string =>
  value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();

export type InvoiceSettingsParsed =
  | { ok: true; values: InvoiceSettingsValues }
  | { ok: false; errors: Partial<Record<InvoiceSettingsField, string>> };

export function parseInvoiceSettings(form: InvoiceSettingsForm): InvoiceSettingsParsed {
  const raw = typeof form.footerNote === "string" ? cleanNote(form.footerNote) : "";
  if ([...raw].length > FOOTER_NOTE_MAX) return { ok: false, errors: { footerNote: `Keep the note under ${FOOTER_NOTE_MAX} characters.` } };
  return {
    ok: true,
    values: { enabled: on(form.enabled, true), footerNote: raw === "" ? null : raw, emailWithConfirmation: on(form.emailWithConfirmation, true) },
  };
}

export type SeriesForm = { series?: unknown; prefix?: unknown; nextNumber?: unknown };
export type SeriesParsed =
  | { ok: true; series: SeriesName; prefix: string; nextNumber: number }
  | { ok: false; errors: Partial<Record<"series" | "prefix" | "nextNumber", string>> };

/** The first number a series may start at: whole, 1 or more, and small enough to count up from safely. */
export const MAX_FIRST_NUMBER = 999_999_999;

export function parseSeries(form: SeriesForm): SeriesParsed {
  const errors: Partial<Record<"series" | "prefix" | "nextNumber", string>> = {};
  const series = typeof form.series === "string" && (SERIES_NAMES as readonly string[]).includes(form.series) ? (form.series as SeriesName) : null;
  if (!series) errors.series = "Choose the invoice or the credit note series.";
  const prefix = typeof form.prefix === "string" ? form.prefix.trim() : "";
  if (!PREFIX_PATTERN.test(prefix)) errors.prefix = "A prefix is up to 10 letters, digits and . _ / -";
  const text = typeof form.nextNumber === "number" ? String(form.nextNumber) : typeof form.nextNumber === "string" ? form.nextNumber.trim() : "";
  const nextNumber = /^\d{1,9}$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(nextNumber) || nextNumber < 1 || nextNumber > MAX_FIRST_NUMBER) errors.nextNumber = "The first number is a whole number from 1.";
  if (Object.keys(errors).length > 0 || !series) return { ok: false, errors };
  return { ok: true, series, prefix, nextNumber };
}

/** What the database's own refusals mean in words (`commerce.set_sales_series()` and the D141 guard). */
export function seriesProblem(message: string): string | null {
  if (/document_series\.issued|restrict_violation|series_guard|cannot be (re)?numbered|already issued/i.test(message)) {
    return "Numbers already issued cannot be changed.";
  }
  if (/document_series\.prefix/.test(message)) return "A prefix is up to 10 letters, digits and . _ / -";
  if (/document_series\.number/.test(message)) return "The first number is a whole number from 1.";
  if (/document_series\.unknown/.test(message)) return "This store has no such series.";
  return null;
}
