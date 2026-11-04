import type { CreditNoteSnapshot } from "./credit-allocation";
import type { OrderInvoiceSnapshot } from "./invoice-snapshot";
import { clipText, decimalOf, externalVoucherNumber, norwegianOrgNumber } from "./tripletex";
import { standardKeyOf, type BookingKey } from "./tripletex-settings";

/**
 * Tripletex (D453): a Kaizena Flow document as a Tripletex voucher. Work's invoices and credit notes and the shop's are first
 * read into one shape (`BookingDoc`), then `voucherBody()` writes the voucher: the receivable on the customer for the
 * document's total, and one income posting per line with the line's VAT code, so Tripletex, which works VAT out of each gross
 * amount, arrives at the VAT each line was charged. A credit note is the same with the signs turned. Kaizena Flow's number is
 * the invoice's only number: Tripletex keeps it as the external voucher number and on the receivable. Pure.
 */

export type DocSource = "work" | "shop";
export type DocKind = "invoice" | "credit_note";

/** A line to book: its bucket (`null` when no bucket fits, such as IOSS), its words, and its amount with VAT. */
export type BookingLine = { key: BookingKey | null; text: string; grossMinor: number };

/**
 * Whose receivable it is. A Work client is a customer of its own. A shop order from a business with a Norwegian organisation
 * number is that business; every other shop order is one customer per store, "Online shop customers", so no shopper's name or
 * address reaches the books.
 */
export type CustomerRef = { kind: "work_client"; clientId: string } | { kind: "shop_business"; orgNumber: string; name: string } | { kind: "shop_customers" };

export type BookingDoc = {
  source: DocSource;
  kind: DocKind;
  id: string;
  documentNumber: string;
  /** The invoice: the document's own number, or the one a credit note refers to. */
  invoiceNumber: string;
  issuedOn: string;
  currency: string;
  /** With VAT, positive (a credit note's too). */
  totalMinor: number;
  lines: BookingLine[];
  customer: CustomerRef;
  /** The name on the voucher's text: the client or business, or null for a shopper. */
  counterparty: string | null;
};

/** The sync's own key for a customer: a Work client's id, `org:{number}`, or `shop`. */
export function customerKey(ref: CustomerRef): string {
  if (ref.kind === "work_client") return ref.clientId;
  if (ref.kind === "shop_business") return `org:${ref.orgNumber}`;
  return "shop";
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading documents
// ---------------------------------------------------------------------------------------------------------------------

/** A Work line's bucket: its category, and its frozen rate for standard VAT. */
export function workLineKey(vatCategory: string, vatRate: number | string): BookingKey | null {
  if (vatCategory === "standard") return standardKeyOf(vatRate);
  if (vatCategory === "exempt" || vatCategory === "outside_scope" || vatCategory === "reverse_charge") return vatCategory;
  return null;
}

export type WorkLineRow = { description: string; vatCategory: string; vatRate: number | string; inclMinor: number };

export type WorkInvoiceRow = {
  id: string;
  documentNumber: string;
  issuedOn: string;
  currency: string;
  totalMinor: number;
  clientId: string;
  /** The buyer's name as printed (`buyer.legalName ?? buyer.name` of the snapshot). */
  buyerName: string;
  lines: WorkLineRow[];
};

export function workInvoiceDoc(row: WorkInvoiceRow): BookingDoc {
  return {
    source: "work",
    kind: "invoice",
    id: row.id,
    documentNumber: row.documentNumber,
    invoiceNumber: row.documentNumber,
    issuedOn: row.issuedOn,
    currency: row.currency,
    totalMinor: row.totalMinor,
    lines: row.lines.map((l) => ({ key: workLineKey(l.vatCategory, l.vatRate), text: l.description, grossMinor: l.inclMinor })),
    customer: { kind: "work_client", clientId: row.clientId },
    counterparty: row.buyerName,
  };
}

/** A Work credit note's `lines` JSON as `commerce.credit_work_invoice()` writes it (snake case). */
type WorkCreditLineJson = { description?: unknown; vat_category?: unknown; vat_rate?: unknown; incl_minor?: unknown };

export type WorkCreditNoteRow = Omit<WorkInvoiceRow, "lines"> & { invoiceNumber: string; lines: unknown };

export function workCreditNoteDoc(row: WorkCreditNoteRow): BookingDoc {
  const lines = (Array.isArray(row.lines) ? (row.lines as WorkCreditLineJson[]) : []).map((l) => ({
    key: workLineKey(String(l.vat_category ?? ""), Number(l.vat_rate ?? NaN)),
    text: String(l.description ?? ""),
    grossMinor: Number(l.incl_minor ?? NaN),
  }));
  return {
    source: "work",
    kind: "credit_note",
    id: row.id,
    documentNumber: row.documentNumber,
    invoiceNumber: row.invoiceNumber,
    issuedOn: row.issuedOn,
    currency: row.currency,
    totalMinor: row.totalMinor,
    lines,
    customer: { kind: "work_client", clientId: row.clientId },
    counterparty: row.buyerName,
  };
}

/** A shop line or bucket's bucket: reverse charge and exemption by basis, standard by rate, a gift card apart; IOSS has none. */
export function shopKey(basis: string, rate: number, voucher = false): BookingKey | null {
  if (voucher) return "gift_card";
  if (basis === "standard") return standardKeyOf(rate);
  if (basis === "exempt" || basis === "reverse_charge") return basis;
  return null;
}

function shopCustomer(buyer: OrderInvoiceSnapshot["buyer"]): { customer: CustomerRef; counterparty: string | null } {
  const org = buyer.type === "business" ? norwegianOrgNumber(buyer.organisationNumber) : null;
  const name = buyer.company?.trim() || buyer.name?.trim() || null;
  if (org && name) return { customer: { kind: "shop_business", orgNumber: org, name }, counterparty: name };
  return { customer: { kind: "shop_customers" }, counterparty: null };
}

export function shopInvoiceDoc(id: string, snapshot: OrderInvoiceSnapshot): BookingDoc {
  const lines: BookingLine[] = snapshot.lines.map((l) => ({ key: shopKey(l.basis, l.vatRate, l.voucher === true), text: l.title, grossMinor: l.grossMinor }));
  if (snapshot.shipping && snapshot.shipping.grossMinor !== 0) {
    lines.push({ key: shopKey(snapshot.shipping.basis, snapshot.shipping.vatRate), text: snapshot.shipping.label ?? "Shipping", grossMinor: snapshot.shipping.grossMinor });
  }
  return {
    source: "shop",
    kind: "invoice",
    id,
    documentNumber: snapshot.number,
    invoiceNumber: snapshot.number,
    issuedOn: snapshot.issuedOn,
    currency: snapshot.currency,
    totalMinor: snapshot.totals.grossMinor,
    lines,
    ...shopCustomer(snapshot.buyer),
  };
}

/**
 * A shop credit note, booked per VAT bucket: its VAT was worked out of each bucket's gross (`creditFromGross()`), as Tripletex
 * works it out of a posting's. A bucket at 0 % standard is a gift card's when the invoice it credits sold one and nothing
 * else at 0 %; otherwise it is a sale without VAT.
 */
export function shopCreditNoteDoc(id: string, snapshot: CreditNoteSnapshot, invoice: Pick<OrderInvoiceSnapshot, "lines">): BookingDoc {
  const zeroStandard = invoice.lines.filter((l) => l.basis === "standard" && l.vatRate === 0);
  const zeroIsGiftCard = zeroStandard.length > 0 && zeroStandard.every((l) => l.voucher === true);
  const lines: BookingLine[] = snapshot.buckets
    .filter((b) => b.grossMinor !== 0)
    .map((b) => ({
      key: shopKey(b.basis, b.rate, b.basis === "standard" && b.rate === 0 && zeroIsGiftCard),
      text: `${Math.round(b.rate * 100)} %`,
      grossMinor: b.grossMinor,
    }));
  return {
    source: "shop",
    kind: "credit_note",
    id,
    documentNumber: snapshot.number,
    invoiceNumber: snapshot.refersTo.invoiceNumber,
    issuedOn: snapshot.issuedOn,
    currency: snapshot.currency,
    totalMinor: snapshot.totals.grossMinor,
    lines,
    ...shopCustomer(snapshot.buyer),
  };
}

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

/** The keys a document needs, so the sync can say which mapping is missing before it builds anything. */
export function keysOf(doc: BookingDoc): (BookingKey | null)[] {
  return [...new Set(doc.lines.map((l) => l.key))];
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
