import { clipText, norwegianOrgNumber, type BookingDoc, type BookingKey, type CustomerRef } from "./accounting-docs";
import { decimalOf, externalVoucherNumber } from "./tripletex";

/**
 * Tripletex (D453): a Kaizena Flow document as a Tripletex voucher. Work's invoices and credit notes and the shop's are first
 * read into one shape (`BookingDoc`), then `voucherBody()` writes the voucher: the receivable on the customer for the
 * document's total, and one income posting per line with the line's VAT code, so Tripletex, which works VAT out of each gross
 * amount, arrives at the VAT each line was charged. A credit note is the same with the signs turned. Kaizena Flow's number is
 * the invoice's only number: Tripletex keeps it as the external voucher number and on the receivable. Pure.
 */

// The documents as every accounting connection reads them (D460): kept here under their old names for Tripletex's modules and tests.
export {
  customerKey,
  keysOf,
  shopCreditNoteDoc,
  shopInvoiceDoc,
  shopKey,
  workCreditNoteDoc,
  workInvoiceDoc,
  workLineKey,
  type BookingDoc,
  type BookingLine,
  type CustomerRef,
  type DocKind,
  type DocSource,
  type WorkCreditNoteRow,
  type WorkInvoiceRow,
  type WorkLineRow,
} from "./accounting-docs";

// ---------------------------------------------------------------------------------------------------------------------
// Writing the voucher
// ---------------------------------------------------------------------------------------------------------------------

/** The company's own ids for what the settings name by number, resolved by the server at the start of a run. */
export type VoucherIds = {
  receivableAccountId: number;
  customerId: number;
  bookings: Partial<Record<BookingKey, { accountId: number; vatTypeId: number }>>;
  voucherTypeId: number | null;
};

/** Why a document cannot be booked as it is: it waits for a person, with this code, and nothing is sent. */
export type BlockCode = "currency_unsupported" | "vat_unmapped" | "totals_mismatch" | "nothing_to_book";

export type VoucherPosting = {
  row: number;
  date: string;
  description: string;
  account: { id: number };
  amountGross: number;
  amountGrossCurrency: number;
  customer?: { id: number };
  vatType?: { id: number };
  invoiceNumber?: string;
};

export type VoucherBody = {
  date: string;
  description: string;
  externalVoucherNumber: string;
  voucherType?: { id: number };
  postings: VoucherPosting[];
};

/** Currencies booked in this version: Norwegian kroner only (others wait, visibly, for the foreign-currency step). */
export const BOOKED_CURRENCIES = ["NOK"] as const;

const WORDS = {
  nb: { invoice: "Faktura", credit: "Kreditnota", for: "for", shop: "Nettbutikk" },
  en: { invoice: "Invoice", credit: "Credit note", for: "for", shop: "Online shop" },
} as const;

/** The voucher's text: what it is, its number, and whose (the shop's own word for a shopper). */
export function voucherText(doc: BookingDoc, language: "nb" | "en"): string {
  const w = WORDS[language];
  const who = doc.counterparty ?? w.shop;
  const what = doc.kind === "invoice" ? `${w.invoice} ${doc.documentNumber}` : `${w.credit} ${doc.documentNumber} ${w.for} ${doc.invoiceNumber}`;
  return clipText(`${what} · ${who}`);
}

/**
 * The voucher for a document, or the reason it waits. Postings: row 1 the receivable (with the customer and the invoice
 * number, so a payment can be matched to it), then one posting per line. An invoice debits the receivable and credits
 * income; a credit note the reverse. Lines that come to nothing are left out; the postings always sum to zero.
 */
export function voucherBody(
  doc: BookingDoc,
  ids: VoucherIds,
  ctx: { storeId: string; language: "nb" | "en"; posting?: number },
): { ok: true; body: VoucherBody } | { ok: false; code: BlockCode; detail?: string } {
  if (!(BOOKED_CURRENCIES as readonly string[]).includes(doc.currency)) return { ok: false, code: "currency_unsupported", detail: doc.currency };
  const lines = doc.lines.filter((l) => l.grossMinor !== 0);
  if (lines.length === 0 || doc.totalMinor <= 0) return { ok: false, code: "nothing_to_book" };
  for (const line of lines) {
    if (!Number.isSafeInteger(line.grossMinor)) return { ok: false, code: "totals_mismatch" };
    if (line.key === null) return { ok: false, code: "vat_unmapped", detail: "none" };
    if (!ids.bookings[line.key]) return { ok: false, code: "vat_unmapped", detail: line.key };
  }
  const sum = lines.reduce((s, l) => s + l.grossMinor, 0);
  if (sum !== doc.totalMinor) return { ok: false, code: "totals_mismatch" };

  const sign = doc.kind === "invoice" ? 1 : -1;
  const description = voucherText(doc, ctx.language);
  const postings: VoucherPosting[] = [
    {
      row: 1,
      date: doc.issuedOn,
      description,
      account: { id: ids.receivableAccountId },
      customer: { id: ids.customerId },
      amountGross: decimalOf(sign * doc.totalMinor),
      amountGrossCurrency: decimalOf(sign * doc.totalMinor),
      invoiceNumber: doc.invoiceNumber,
    },
    ...lines.map((line, i): VoucherPosting => {
      const booking = ids.bookings[line.key as BookingKey]!;
      return {
        row: i + 2,
        date: doc.issuedOn,
        description: clipText(`${doc.documentNumber} ${line.text}`),
        account: { id: booking.accountId },
        vatType: { id: booking.vatTypeId },
        amountGross: decimalOf(-sign * line.grossMinor),
        amountGrossCurrency: decimalOf(-sign * line.grossMinor),
      };
    }),
  ];
  return {
    ok: true,
    body: {
      date: doc.issuedOn,
      description,
      externalVoucherNumber: externalVoucherNumber(ctx.storeId, doc.documentNumber, ctx.posting ?? 1),
      ...(ids.voucherTypeId ? { voucherType: { id: ids.voucherTypeId } } : {}),
      postings,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------------------------------

/** A Work client as it is read for its customer card. */
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

/** A customer card for Tripletex (`POST /customer`, `PUT /customer/{id}`). */
export type CustomerBody = {
  name: string;
  organizationNumber?: string;
  isPrivateIndividual: boolean;
  language: "NO" | "EN";
  invoiceSendMethod: "MANUAL";
  invoicesDueIn?: number;
  invoicesDueInType?: "DAYS";
  email?: string;
  description?: string;
  postalAddress?: { addressLine1?: string; addressLine2?: string; postalCode?: string; city?: string; country?: { id: number } };
};

/**
 * A Work client's customer card, with as little about them as the books need: a consumer is a name and a country; a business
 * adds its organisation number (Norwegian only: Tripletex has no field for a foreign VAT number, which goes in the description)
 * and its billing address. The email only when the owner switched it on. `MANUAL` so Tripletex never sends them anything.
 */
export function workCustomerBody(client: WorkClientRow, opts: { sendContactEmail: boolean; countryId: number | null }): CustomerBody {
  const name = clipText(client.legalName?.trim() || client.name, 255);
  const org = client.business ? norwegianOrgNumber(client.organisationNumber) : null;
  const country = opts.countryId ? { country: { id: opts.countryId } } : {};
  const a = client.billingAddress ?? {};
  const text = (v: string | null | undefined) => (v && v.trim() !== "" ? clipText(v, 100) : undefined);
  const address = client.business
    ? Object.fromEntries(
        Object.entries({ addressLine1: text(a.line1), addressLine2: text(a.line2), postalCode: text(a.postalCode), city: text(a.city) }).filter(([, v]) => v !== undefined),
      )
    : {};
  const foreignVat = client.business && !org && client.vatNumber?.trim() ? `VAT ${clipText(client.vatNumber, 40)}` : undefined;
  const postal = { ...address, ...country };
  return {
    name,
    ...(org ? { organizationNumber: org } : {}),
    isPrivateIndividual: !client.business,
    language: (client.locale ?? "").toLowerCase().startsWith("nb") || (client.locale ?? "").toLowerCase().startsWith("no") ? "NO" : "EN",
    invoiceSendMethod: "MANUAL",
    ...(client.paymentDays ? { invoicesDueIn: client.paymentDays, invoicesDueInType: "DAYS" as const } : {}),
    ...(opts.sendContactEmail && client.billingEmail ? { email: client.billingEmail.trim() } : {}),
    ...(foreignVat ? { description: foreignVat } : {}),
    ...(Object.keys(postal).length > 0 ? { postalAddress: postal } : {}),
  };
}

/** The shop's customers: one card per store for every shopper, and one per Norwegian business that bought. */
export function shopCustomerBody(ref: Exclude<CustomerRef, { kind: "work_client" }>, language: "nb" | "en"): CustomerBody {
  if (ref.kind === "shop_business") {
    return { name: clipText(ref.name, 255), organizationNumber: ref.orgNumber, isPrivateIndividual: false, language: "NO", invoiceSendMethod: "MANUAL" };
  }
  return {
    name: language === "nb" ? "Nettbutikkunder (Kaizena Flow)" : "Online shop customers (Kaizena Flow)",
    isPrivateIndividual: false,
    language: language === "nb" ? "NO" : "EN",
    invoiceSendMethod: "MANUAL",
  };
}

/** A value as JSON with its keys sorted, so the same card always hashes the same (`content_hash`). */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
