import { formatMoney } from "@/lib/money";
import { minorToDecimal } from "@/lib/work-calc";
import { formatDay } from "@/lib/work-dates";
import { type DocumentLabels, documentLanguage } from "@/lib/work-invoice-text";

/**
 * The small pure rules behind Work's printed documents (docs/work.md 4.7):
 * which invoices may be printed at all, and how a document writes its
 * numbers, days and names in its own language. Nothing here reads the
 * database, so the print page and its tests share it.
 */

export type PrintableState = { printable: true } | { printable: false; reason: "draft" | "unnumbered" };

/**
 * Only an issued invoice prints (4.6): a draft has no number and its seller
 * and buyer are still live, so a printout of it could be mistaken for the
 * invoice. There is no draft preview and no watermark.
 */
export function printableState(invoice: { status: string; documentNumber: string | null }): PrintableState {
  if (invoice.status === "draft") return { printable: false, reason: "draft" };
  if (!invoice.documentNumber?.trim()) return { printable: false, reason: "unnumbered" };
  return { printable: true };
}

/** A locale `Intl` accepts: the document's own, else its language (a wrong tag must never stop a print). */
export function printLocale(locale: string | null | undefined): string {
  const tag = (locale ?? "").replace("_", "-");
  try {
    if (tag) return Intl.getCanonicalLocales(tag)[0] ?? documentLanguage(locale);
  } catch {
    // Not a language tag: fall through.
  }
  return documentLanguage(locale);
}

/** Money in the document's locale from integer minor units; a currency `formatMoney` does not know still prints. */
export function moneyText(minor: number, currency: string, locale: string): string {
  try {
    return formatMoney(minor, currency, locale);
  } catch {
    return `${minorToDecimal(minor, "EUR")} ${currency}`;
  }
}

/** A percentage from basis points: 2500 is "25 %" in Norwegian, "25%" in English; 1250 is 12.5. */
export function percentText(bp: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(bp / 10_000);
}

/**
 * A line's quantity as people read it: hours with two decimals and the
 * language's own unit ("1,75 t"), other units with up to two decimals ("3 stk").
 */
export function quantityText(
  line: { unit: "hour" | "unit"; quantityHundredths: number },
  locale: string,
  labels: Pick<DocumentLabels, "hoursUnit" | "unitUnit">,
): string {
  const hours = line.unit === "hour";
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: hours ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(line.quantityHundredths / 100);
  return `${number} ${hours ? labels.hoursUnit : labels.unitUnit}`;
}

/** A calendar day in the document's locale; text that is not a day is shown as it is. */
export function dayText(day: string | null | undefined, locale: string): string {
  if (!day) return "";
  try {
    return formatDay(day.slice(0, 10), locale);
  } catch {
    return day;
  }
}

/** The service period as one text: one day, or "from – to", or the one end that is known. */
export function periodText(period: { from: string | null; to: string | null } | null, locale: string): string {
  if (!period) return "";
  const from = dayText(period.from, locale);
  const to = dayText(period.to, locale);
  if (from && to) return from === to ? from : `${from} – ${to}`;
  return from || to;
}

/** A country's name in the document's language, from its ISO code (the code itself when unknown). */
export function countryText(code: string | null | undefined, locale: string): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** An exchange rate without its trailing zeros: "11.50000000" is "11.5". */
export function rateText(rate: string): string {
  return rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
}

/** A buyer's address as lines, empty parts left out. */
export function addressLines(address: {
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
}): string[] {
  const place = [address.postalCode, address.city]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return [address.line1, address.line2, place].map((part) => part?.trim() ?? "").filter(Boolean);
}

/**
 * What a saved PDF is called: the browser names it after the page's title, so
 * the print button sets the title to this while the dialog is open
 * ("Faktura W-1001"). Characters a file name cannot have are dropped.
 */
export function documentFileName(title: string, documentNumber: string | null): string {
  return [title, documentNumber]
    .filter(Boolean)
    .join(" ")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
