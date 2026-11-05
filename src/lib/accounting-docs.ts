import type { CreditNoteSnapshot } from "./credit-allocation";
import type { OrderInvoiceSnapshot } from "./invoice-snapshot";

/**
 * What every accounting connection books (Tripletex D453, Fiken D460): a Kaizena Flow document read into one shape (`BookingDoc`).
 * Work's invoices and credit notes and the shop's are read the same way for each system, so a document is booked alike wherever the
 * owner keeps their books: each line in a VAT bucket (`BookingKey`), with its amount with VAT and, where the system takes them, its net
 * and VAT as the document has them. The writing is each system's own (`tripletex-map.ts`, `fiken-map.ts`). Pure; safe in the browser.
 */

// ---------------------------------------------------------------------------------------------------------------------
// The buckets
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The buckets. Norwegian VAT for sales [docs: Tripletex's code list]:
 * - `standard_25`, `standard_15`, `standard_12`: output VAT at the high, middle and low rate (codes 3, 31 and 33).
 * - `standard_0`: no VAT charged by a seller that is not VAT registered.
 * - `exempt`: sales exempt from VAT within the VAT act (code 5).
 * - `outside_scope`: outside the VAT act (code 6).
 * - `reverse_charge`: services to a business abroad, VAT due by the buyer (code 6 by default; the accountant may choose 52).
 * - `gift_card`: a gift card sold is a debt to its holder until spent, not income (no VAT code).
 */
export const BOOKING_KEYS = ["standard_25", "standard_15", "standard_12", "standard_0", "exempt", "outside_scope", "reverse_charge", "gift_card"] as const;

export type BookingKey = (typeof BOOKING_KEYS)[number];

export const isBookingKey = (value: string): value is BookingKey => (BOOKING_KEYS as readonly string[]).includes(value);

/** The bucket of a VAT rate charged at the standard basis (a fraction such as 0.25 or the text `0.2500`), or null for a rate Norway does not have. */
export function standardKeyOf(rate: number | string): BookingKey | null {
  const bp = Math.round(Number(rate) * 10000);
  if (bp === 2500) return "standard_25";
  if (bp === 1500) return "standard_15";
  if (bp === 1200) return "standard_12";
  if (bp === 0) return "standard_0";
  return null;
}

/** How a person reads each bucket, in the settings and in the summary for the accountant. */
export const BOOKING_WORDS: Record<BookingKey, { en: string; nb: string }> = {
  standard_25: { en: "Sales with 25% VAT", nb: "Salg med 25 % mva" },
  standard_15: { en: "Sales with 15% VAT (food)", nb: "Salg med 15 % mva (mat)" },
  standard_12: { en: "Sales with 12% VAT", nb: "Salg med 12 % mva" },
  standard_0: { en: "Sales without VAT (not VAT registered)", nb: "Salg uten mva (ikke mva-registrert)" },
  exempt: { en: "Sales exempt from VAT", nb: "Salg fritatt for mva" },
  outside_scope: { en: "Sales outside the VAT act", nb: "Salg utenfor mva-loven" },
  reverse_charge: { en: "Services to businesses abroad", nb: "Tjenester til næringsdrivende i utlandet" },
  gift_card: { en: "Gift cards sold (owed to their holders)", nb: "Solgte gavekort (gjeld til innehaver)" },
};

// ---------------------------------------------------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------------------------------------------------

/** Text an accounting system keeps on a voucher, a sale or a line: one line, no control characters, clipped (limits vary, so kept short). */
export function clipText(text: string, max = 100): string {
  const one = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

/** A Norwegian organisation number (nine digits, as Brønnøysund keeps them), or null. Spaces and an `MVA` suffix are dropped. */
export function norwegianOrgNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/^NO/i, "").replace(/MVA$/i, "").replace(/[\s.-]/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------------------------------

export type DocSource = "work" | "shop";
export type DocKind = "invoice" | "credit_note";

/**
 * A line to book: its bucket (`null` when no bucket fits, such as IOSS), its words, and its amount with VAT. `netMinor` and `vatMinor` are
 * the document's own split of it (every reader gives them; a system that works VAT out itself, as Tripletex does, reads only the gross).
 */
export type BookingLine = { key: BookingKey | null; text: string; grossMinor: number; netMinor?: number; vatMinor?: number };

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
  /** When it is due, where the document says (a Work invoice); a shop's is paid at checkout, so its issue day. */
  dueOn?: string | null;
  currency: string;
  /** With VAT, positive (a credit note's too). */
  totalMinor: number;
  /** The VAT on the document, positive, to compare with what the system works out (`variance_minor`). */
  vatMinor: number;
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

/** The keys a document needs, so the sync can say which mapping is missing before it builds anything. */
export function keysOf(doc: BookingDoc): (BookingKey | null)[] {
  return [...new Set(doc.lines.map((l) => l.key))];
}

/** A Work line's bucket: its category, and its frozen rate for standard VAT. */
export function workLineKey(vatCategory: string, vatRate: number | string): BookingKey | null {
  if (vatCategory === "standard") return standardKeyOf(vatRate);
  if (vatCategory === "exempt" || vatCategory === "outside_scope" || vatCategory === "reverse_charge") return vatCategory;
  return null;
}

export type WorkLineRow = { description: string; vatCategory: string; vatRate: number | string; inclMinor: number; exclMinor?: number; vatMinor?: number };

export type WorkInvoiceRow = {
  id: string;
  documentNumber: string;
  issuedOn: string;
  dueOn?: string | null;
  currency: string;
  totalMinor: number;
  vatMinor: number;
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
    dueOn: row.dueOn ?? null,
    currency: row.currency,
    totalMinor: row.totalMinor,
    vatMinor: row.vatMinor,
    lines: row.lines.map((l) => ({
      key: workLineKey(l.vatCategory, l.vatRate),
      text: l.description,
      grossMinor: l.inclMinor,
      ...(l.exclMinor !== undefined && l.vatMinor !== undefined ? { netMinor: l.exclMinor, vatMinor: l.vatMinor } : {}),
    })),
    customer: { kind: "work_client", clientId: row.clientId },
    counterparty: row.buyerName,
  };
}

/** A Work credit note's `lines` JSON as `commerce.credit_work_invoice()` writes it (snake case). */
type WorkCreditLineJson = { description?: unknown; vat_category?: unknown; vat_rate?: unknown; incl_minor?: unknown; excl_minor?: unknown; vat_minor?: unknown };

export type WorkCreditNoteRow = Omit<WorkInvoiceRow, "lines"> & { invoiceNumber: string; lines: unknown };

export function workCreditNoteDoc(row: WorkCreditNoteRow): BookingDoc {
  const lines = (Array.isArray(row.lines) ? (row.lines as WorkCreditLineJson[]) : []).map((l): BookingLine => {
    const net = l.excl_minor === undefined ? NaN : Number(l.excl_minor);
    const vat = l.vat_minor === undefined ? NaN : Number(l.vat_minor);
    return {
      key: workLineKey(String(l.vat_category ?? ""), Number(l.vat_rate ?? NaN)),
      text: String(l.description ?? ""),
      grossMinor: Number(l.incl_minor ?? NaN),
      ...(Number.isSafeInteger(net) && Number.isSafeInteger(vat) ? { netMinor: net, vatMinor: vat } : {}),
    };
  });
  return {
    source: "work",
    kind: "credit_note",
    id: row.id,
    documentNumber: row.documentNumber,
    invoiceNumber: row.invoiceNumber,
    issuedOn: row.issuedOn,
    dueOn: row.dueOn ?? null,
    currency: row.currency,
    totalMinor: row.totalMinor,
    vatMinor: row.vatMinor,
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
  const lines: BookingLine[] = snapshot.lines.map((l) => ({
    key: shopKey(l.basis, l.vatRate, l.voucher === true),
    text: l.title,
    grossMinor: l.grossMinor,
    netMinor: l.netMinor,
    vatMinor: l.vatMinor,
  }));
  if (snapshot.shipping && snapshot.shipping.grossMinor !== 0) {
    lines.push({
      key: shopKey(snapshot.shipping.basis, snapshot.shipping.vatRate),
      text: snapshot.shipping.label ?? "Shipping",
      grossMinor: snapshot.shipping.grossMinor,
      netMinor: snapshot.shipping.netMinor,
      vatMinor: snapshot.shipping.vatMinor,
    });
  }
  return {
    source: "shop",
    kind: "invoice",
    id,
    documentNumber: snapshot.number,
    invoiceNumber: snapshot.number,
    issuedOn: snapshot.issuedOn,
    dueOn: snapshot.issuedOn,
    currency: snapshot.currency,
    totalMinor: snapshot.totals.grossMinor,
    vatMinor: snapshot.totals.vatMinor,
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
      netMinor: b.netMinor,
      vatMinor: b.vatMinor,
    }));
  return {
    source: "shop",
    kind: "credit_note",
    id,
    documentNumber: snapshot.number,
    invoiceNumber: snapshot.refersTo.invoiceNumber,
    issuedOn: snapshot.issuedOn,
    dueOn: snapshot.issuedOn,
    currency: snapshot.currency,
    totalMinor: snapshot.totals.grossMinor,
    vatMinor: snapshot.totals.vatMinor,
    lines,
    ...shopCustomer(snapshot.buyer),
  };
}
