import { clipText, norwegianOrgNumber, type BookingDoc, type BookingKey, type CustomerRef } from "./accounting-docs";
import { countryName, saleNumberOf } from "./fiken";
import type { FikenSettings, FikenVatType } from "./fiken-settings";

/**
 * Fiken (D460): a Kaizena Flow document as a sale in Fiken. Fiken's "Annet salg" (`POST /sales`, kind `external_invoice`) is its own
 * way in for an invoice numbered and sent outside Fiken: the customer's receivable for the whole document, and one line per document line
 * with its account, its VAT type and the net and VAT the document charged (Fiken takes both in øre, so nothing is worked out again and no
 * øre is lost). A credit note is a sale with the lines turned negative, on the same customer, numbered as the credit note. Kaizena Flow's
 * number is the sale's only number. Pure.
 */

/** Why a document cannot be booked as it is: it waits for a person, with this code, and nothing is sent. */
export type FikenBlockCode = "currency_unsupported" | "vat_unmapped" | "totals_mismatch" | "nothing_to_book";

export type SaleLine = { description: string; netPrice: number; vat: number; account: string; vatType: FikenVatType };

export type SaleBody = {
  saleNumber: string;
  date: string;
  kind: "external_invoice";
  currency: "NOK";
  customerId: number;
  dueDate: string;
  lines: SaleLine[];
};

/** Currencies booked in this version: Norwegian kroner only (others wait, visibly, for the foreign-currency step). */
export const FIKEN_CURRENCIES = ["NOK"] as const;

const WORDS = {
  nb: { credit: "Kreditnota", for: "for faktura", shop: "Nettbutikk", shipping: "Frakt" },
  en: { credit: "Credit note", for: "for invoice", shop: "Online shop", shipping: "Shipping" },
} as const;

/** The day a sale is due: the document's own, never before it was issued. */
const dueOf = (doc: BookingDoc) => (doc.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(doc.dueOn) && doc.dueOn > doc.issuedOn ? doc.dueOn : doc.issuedOn);

/**
 * The sale for a document, or the reason it waits. Lines that come to nothing are left out; every line's net and VAT must add up to its
 * amount with VAT, and the lines to the document's total, or nothing is sent.
 */
export function saleBody(
  doc: BookingDoc,
  ctx: { customerId: number; bookings: FikenSettings["bookings"]; language: "nb" | "en" },
): { ok: true; body: SaleBody } | { ok: false; code: FikenBlockCode; detail?: string } {
  if (!(FIKEN_CURRENCIES as readonly string[]).includes(doc.currency)) return { ok: false, code: "currency_unsupported", detail: doc.currency };
  const lines = doc.lines.filter((l) => l.grossMinor !== 0);
  if (lines.length === 0 || doc.totalMinor <= 0) return { ok: false, code: "nothing_to_book" };
  for (const line of lines) {
    if (line.key === null) return { ok: false, code: "vat_unmapped", detail: "none" };
    if (!ctx.bookings[line.key]) return { ok: false, code: "vat_unmapped", detail: line.key };
    const { netMinor, vatMinor, grossMinor } = line;
    if (!Number.isSafeInteger(grossMinor) || netMinor === undefined || vatMinor === undefined) return { ok: false, code: "totals_mismatch" };
    if (!Number.isSafeInteger(netMinor) || !Number.isSafeInteger(vatMinor) || netMinor + vatMinor !== grossMinor) return { ok: false, code: "totals_mismatch" };
  }
  if (lines.reduce((s, l) => s + l.grossMinor, 0) !== doc.totalMinor) return { ok: false, code: "totals_mismatch" };

  const w = WORDS[ctx.language];
  const sign = doc.kind === "invoice" ? 1 : -1;
  const prefix = doc.kind === "credit_note" ? `${w.credit} ${doc.documentNumber} ${w.for} ${doc.invoiceNumber}: ` : "";
  return {
    ok: true,
    body: {
      saleNumber: saleNumberOf(doc.documentNumber),
      date: doc.issuedOn,
      kind: "external_invoice",
      currency: "NOK",
      customerId: ctx.customerId,
      dueDate: dueOf(doc),
      lines: lines.map((line) => {
        const booking = ctx.bookings[line.key as BookingKey]!;
        return {
          description: clipText(`${prefix}${line.text || w.shop}`, 200),
          netPrice: sign * line.netMinor!,
          vat: sign * line.vatMinor!,
          account: booking.account,
          vatType: booking.vatType,
        };
      }),
    },
  };
}

/** What Fiken answers for a sale, as far as it is read: to adopt one already there, and to compare what it booked. */
export type SaleAnswer = {
  saleId?: unknown;
  saleNumber?: unknown;
  date?: unknown;
  netAmount?: unknown;
  vatAmount?: unknown;
  deleted?: unknown;
  transactionId?: unknown;
  customer?: { contactId?: unknown } | null;
};

/** The net and VAT of a sale body, as Fiken reports them on the sale (`netAmount`, `vatAmount`). */
export function totalsOf(body: Pick<SaleBody, "lines">): { net: number; vat: number } {
  return body.lines.reduce((t, l) => ({ net: t.net + l.netPrice, vat: t.vat + l.vat }), { net: 0, vat: 0 });
}

/**
 * Whether a sale Fiken already has under this number is this document's: same day, same net and same VAT, not deleted. Only then is it
 * adopted (a lost answer, or the owner's own booking of it by hand); another sale with the number waits for a person, never booked over.
 */
export function sameSale(found: SaleAnswer, body: SaleBody): boolean {
  if (found.deleted === true) return false;
  const { net, vat } = totalsOf(body);
  return found.date === body.date && Number(found.netAmount) === net && Number(found.vatAmount) === vat;
}

// ---------------------------------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------------------------------

/** A Work client as it is read for its contact. */
export type WorkClientRow = {
  name: string;
  legalName: string | null;
  organisationNumber: string | null;
  vatNumber: string | null;
  business: boolean;
  country: string | null;
  billingAddress: { line1?: string | null; line2?: string | null; postalCode?: string | null; city?: string | null } | null;
  billingEmail: string | null;
  locale: string | null;
  paymentDays: number | null;
};

/** A contact for Fiken (`POST /contacts`, `PUT /contacts/{id}`): a customer, and only what the books need. */
export type ContactBody = {
  name: string;
  customer: true;
  organizationNumber?: string;
  email?: string;
  language: "NORWEGIAN" | "ENGLISH";
  daysUntilInvoicingDueDate?: number;
  address?: { streetAddress?: string; streetAddressLine2?: string; postCode?: string; city?: string; country: string };
};

const text = (v: string | null | undefined, max = 100) => (v && v.trim() !== "" ? clipText(v, max) : undefined);

/**
 * A Work client's contact, with as little about them as the books need: a consumer is a name; a business adds its Norwegian organisation
 * number (a foreign VAT number has no field in Fiken and is left out) and its billing address. The email only when the owner switched it on.
 */
export function workContactBody(client: WorkClientRow, opts: { sendContactEmail: boolean }): ContactBody {
  const org = client.business ? norwegianOrgNumber(client.organisationNumber) : null;
  const a = client.billingAddress ?? {};
  const country = countryName(client.country);
  const address =
    client.business && country
      ? Object.fromEntries(
          Object.entries({ streetAddress: text(a.line1), streetAddressLine2: text(a.line2), postCode: text(a.postalCode, 20), city: text(a.city), country }).filter(([, v]) => v !== undefined),
        )
      : null;
  const locale = (client.locale ?? "").toLowerCase();
  return {
    name: clipText(client.legalName?.trim() || client.name, 200),
    customer: true,
    ...(org ? { organizationNumber: org } : {}),
    ...(opts.sendContactEmail && client.billingEmail ? { email: clipText(client.billingEmail.trim(), 200) } : {}),
    language: locale.startsWith("nb") || locale.startsWith("no") || locale.startsWith("nn") ? "NORWEGIAN" : "ENGLISH",
    ...(client.paymentDays ? { daysUntilInvoicingDueDate: client.paymentDays } : {}),
    ...(address ? { address: address as ContactBody["address"] } : {}),
  };
}

/** The shop's customers: one contact per store for every shopper, and one per Norwegian business that bought. */
export function shopContactBody(ref: Exclude<CustomerRef, { kind: "work_client" }>, language: "nb" | "en"): ContactBody {
  if (ref.kind === "shop_business") {
    return { name: clipText(ref.name, 200), customer: true, organizationNumber: ref.orgNumber, language: "NORWEGIAN" };
  }
  return { name: language === "nb" ? "Nettbutikkunder (Kaizena Flow)" : "Online shop customers (Kaizena Flow)", customer: true, language: language === "nb" ? "NORWEGIAN" : "ENGLISH" };
}
