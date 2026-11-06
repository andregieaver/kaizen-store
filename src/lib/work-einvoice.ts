import type { CreditNoteDocument, DocumentLine, InvoiceDocument } from "@/server/work-invoices";

import { CUSTOMIZATION_ID, NS, PROFILE_ID, amount, einvoiceFileName, el, endpoint, sellerParty, taxCategory, unitPrice, xmlText, type EinvoiceProblem } from "./einvoice";
import { minorUnitDigits } from "./money";

/**
 * Work's invoices and credit notes (D122) as EN 16931 UBL with Peppol BIS Billing 3.0's customisation (EHF Billing 3.0 in Norway; B1 of
 * `docs/own-books-and-sales.md`, D463), from the issued document only (`invoiceDocumentData()`, `creditNoteDocumentData()`): its frozen
 * seller and buyer, its lines as they were rounded (VAT per line, the totals their sums) and its VAT groups, never worked out again. As for a
 * shop's documents (D403, `einvoice.ts`), a document a receiver would have to reject is refused with the reasons and never sent: a missing
 * country, VAT charged without the seller's VAT number, reverse charge without the client's, lines outside the scope of VAT beside others
 * (BR-O-11 to 14 allow one or the other), or totals that would not add up (BR-CO-10, 13 to 15).
 */

export type WorkEinvoiceProblem = EinvoiceProblem | "buyer_vat_number" | "outside_scope_mixed";
export type WorkEinvoice = { ok: true; xml: string; fileName: string } | { ok: false; problems: WorkEinvoiceProblem[] };

type Doc = InvoiceDocument | CreditNoteDocument;

/** The UNCL5305 category of a Work line (BT-151): the seller's registration first, then what the line is. */
export function workVatCategory(line: Pick<DocumentLine, "vatCategory" | "vatBp">, sellerRegistered: boolean): "S" | "Z" | "E" | "AE" | "O" {
  if (!sellerRegistered || line.vatCategory === "outside_scope") return "O";
  if (line.vatCategory === "reverse_charge") return "AE";
  if (line.vatCategory === "exempt") return "E";
  return line.vatBp > 0 ? "S" : "Z";
}

/**
 * A VAT identifier as EN 16931 asks for it (BR-CO-9: the country's prefix first), Norway's as `NO` + nine digits + `MVA` (Peppol NO-R-001);
 * one written with its prefix already is kept as it is.
 */
export function vatIdentifier(country: string | null, vatNumber: string | null): string | null {
  const raw = (vatNumber ?? "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return null;
  if (/^[A-Z]{2}/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (country === "NO" && digits.length === 9) return `NO${digits}MVA`;
  return country ? `${country}${raw}` : raw;
}

const rateOf = (vatBp: number) => vatBp / 10_000;

function problemsOf(doc: Doc): WorkEinvoiceProblem[] {
  const problems: WorkEinvoiceProblem[] = [];
  const registered = doc.seller.vatRegistered;
  if (!/^[A-Z]{2}$/.test(doc.seller.country ?? "")) problems.push("seller_country");
  if (!/^[A-Z]{2}$/.test(doc.buyer.country ?? "")) problems.push("buyer_country");
  if (doc.totals.vatMinor > 0 && !doc.seller.vatNumber) problems.push("seller_vat_number");
  const categories = new Set(doc.lines.map((l) => workVatCategory(l, registered)));
  if (categories.has("AE") && !doc.buyer.vatNumber) problems.push("buyer_vat_number");
  if (categories.has("O") && categories.size > 1) problems.push("outside_scope_mixed");
  try {
    minorUnitDigits(doc.currency);
  } catch {
    problems.push("currency");
  }
  const net = doc.lines.reduce((s, l) => s + l.exclMinor, 0);
  const vat = doc.lines.reduce((s, l) => s + l.vatMinor, 0);
  const groupNet = doc.totals.vatGroups.reduce((s, g) => s + g.netMinor, 0);
  const groupVat = doc.totals.vatGroups.reduce((s, g) => s + g.vatMinor, 0);
  if (!doc.consistent || net !== doc.totals.subtotalMinor || vat !== doc.totals.vatMinor || groupNet !== net || groupVat !== vat || net + vat !== doc.totals.totalMinor) {
    problems.push("totals");
  }
  return problems;
}

/** The client (BG-7): its endpoint (its organisation number in its country's scheme, else its email), name, address, VAT and contact. */
function buyerParty(doc: Doc, vatId: string | null): string {
  const b = doc.buyer;
  const name = b.name || b.clientName || b.email || "";
  const end = endpoint(b.country, b.business ? b.organisationNumber : null, b.email);
  return [
    "<cac:AccountingCustomerParty><cac:Party>",
    end ? `<cbc:EndpointID schemeID="${end.scheme}">${xmlText(end.id)}</cbc:EndpointID>` : "",
    `<cac:PartyName>${el("Name", name)}</cac:PartyName>`,
    "<cac:PostalAddress>",
    el("StreetName", b.address.line1),
    el("AdditionalStreetName", b.address.line2),
    el("CityName", b.address.city),
    el("PostalZone", b.address.postalCode),
    `<cac:Country><cbc:IdentificationCode>${xmlText(b.country ?? "")}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
    vatId ? `<cac:PartyTaxScheme>${el("CompanyID", vatId)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    `<cac:PartyLegalEntity>${el("RegistrationName", name)}${b.business ? el("CompanyID", b.organisationNumber) : ""}</cac:PartyLegalEntity>`,
    b.contactName || b.email ? `<cac:Contact>${el("Name", b.contactName)}${el("ElectronicMail", b.email)}</cac:Contact>` : "",
    "</cac:Party></cac:AccountingCustomerParty>",
  ].join("");
}

/** The VAT breakdown (BG-23) from the document's VAT groups, merged by category and rate, and the VAT in the seller's currency (BT-111). */
function taxTotals(doc: Doc): string {
  const c = doc.currency;
  const merged = new Map<string, { category: string; rate: number; net: number; vat: number }>();
  for (const g of doc.totals.vatGroups) {
    const category = workVatCategory({ vatCategory: g.category, vatBp: g.vatBp }, doc.seller.vatRegistered);
    const rate = category === "S" ? rateOf(g.vatBp) : 0;
    const key = `${category}:${rate}`;
    const at = merged.get(key) ?? { category, rate, net: 0, vat: 0 };
    at.net += g.netMinor;
    at.vat += g.vatMinor;
    merged.set(key, at);
  }
  const subtotals = [...merged.values()]
    .map(
      (m) =>
        `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${c}">${amount(m.net, c)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${c}">${amount(m.vat, c)}</cbc:TaxAmount>${taxCategory("TaxCategory", m.category, m.rate, true)}</cac:TaxSubtotal>`,
    )
    .join("");
  const home = doc.vatHome && doc.vatHome.currency !== c ? `<cac:TaxTotal><cbc:TaxAmount currencyID="${doc.vatHome.currency}">${amount(doc.vatHome.amountMinor, doc.vatHome.currency)}</cbc:TaxAmount></cac:TaxTotal>` : "";
  return `<cac:TaxTotal><cbc:TaxAmount currencyID="${c}">${amount(doc.totals.vatMinor, c)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>${home}`;
}

/** How to pay (BG-16): a credit transfer to the seller's account, IBAN as SEPA (58) and a domestic number as a plain transfer (30), with the reference to quote. */
function paymentMeans(doc: InvoiceDocument): string {
  const account = (doc.payment.bankAccount ?? "").replace(/[\s.]/g, "");
  if (!account) return "";
  const iban = /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(account.toUpperCase());
  return [
    "<cac:PaymentMeans>",
    `<cbc:PaymentMeansCode>${iban ? "58" : "30"}</cbc:PaymentMeansCode>`,
    el("PaymentID", doc.payment.paymentReference),
    "<cac:PayeeFinancialAccount>",
    el("ID", iban ? account.toUpperCase() : account),
    doc.payment.bic ? `<cac:FinancialInstitutionBranch>${el("ID", doc.payment.bic.replace(/\s+/g, "").toUpperCase())}</cac:FinancialInstitutionBranch>` : "",
    "</cac:PayeeFinancialAccount>",
    "</cac:PaymentMeans>",
  ].join("");
}

function lineXml(line: DocumentLine, index: number, doc: Doc, credit: boolean): string {
  const c = doc.currency;
  const quantity = line.quantityHundredths / 100;
  const category = workVatCategory(line, doc.seller.vatRegistered);
  const tag = credit ? "CreditNoteLine" : "InvoiceLine";
  return [
    `<cac:${tag}>`,
    `<cbc:ID>${index + 1}</cbc:ID>`,
    `<cbc:${credit ? "CreditedQuantity" : "InvoicedQuantity"} unitCode="${line.unit === "hour" ? "HUR" : "C62"}">${quantity}</cbc:${credit ? "CreditedQuantity" : "InvoicedQuantity"}>`,
    `<cbc:LineExtensionAmount currencyID="${c}">${amount(line.exclMinor, c)}</cbc:LineExtensionAmount>`,
    "<cac:Item>",
    el("Name", line.description || "Work"),
    taxCategory("ClassifiedTaxCategory", category, category === "S" ? rateOf(line.vatBp) : 0, false),
    "</cac:Item>",
    // The net price after the line's discount, up to six decimals, so quantity times price rounds back to the line's net (PEPPOL-EN16931-R120).
    `<cac:Price><cbc:PriceAmount currencyID="${c}">${quantity > 0 ? unitPrice(line.exclMinor, quantity, c) : amount(0, c)}</cbc:PriceAmount></cac:Price>`,
    `</cac:${tag}>`,
  ].join("");
}

/** A Work invoice or credit note as UBL, or why it cannot be one. A draft or an imported invoice is history, never an e-invoice. */
export function workDocumentUbl(doc: Doc): WorkEinvoice {
  if (doc.kind === "invoice" && (doc.draft || doc.imported || !doc.documentNumber || !doc.issuedOn)) return { ok: false, problems: ["totals"] };
  const problems = problemsOf(doc);
  if (problems.length > 0) return { ok: false, problems };
  const c = doc.currency;
  const credit = doc.kind === "credit_note";
  const number = doc.documentNumber as string;
  const issuedOn = doc.issuedOn as string;
  const sellerVat = doc.seller.vatRegistered ? vatIdentifier(doc.seller.country, doc.seller.vatNumber) : null;
  const buyerVat = doc.buyer.business ? vatIdentifier(doc.buyer.country, doc.buyer.vatNumber) : null;
  const total = doc.totals.totalMinor;
  // BT-10 or BT-13 is required (PEPPOL-EN16931-R003): the client's reference, else their contact, else the document's own number.
  const reference = (doc.kind === "invoice" ? doc.reference : null) || doc.buyer.contactName || number;
  const period = doc.kind === "invoice" && doc.servicePeriod && (doc.servicePeriod.from || doc.servicePeriod.to) ? doc.servicePeriod : null;
  const root = credit ? "CreditNote" : "Invoice";
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" ${NS}>`,
    `<cbc:CustomizationID>${CUSTOMIZATION_ID}</cbc:CustomizationID>`,
    `<cbc:ProfileID>${PROFILE_ID}</cbc:ProfileID>`,
    el("ID", number),
    el("IssueDate", issuedOn),
    !credit ? el("DueDate", doc.dueOn) : "",
    credit ? "<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>" : "<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>",
    ...doc.vatNotes.map((n) => el("Note", n.text)),
    `<cbc:DocumentCurrencyCode>${c}</cbc:DocumentCurrencyCode>`,
    doc.vatHome && doc.vatHome.currency !== c ? `<cbc:TaxCurrencyCode>${doc.vatHome.currency}</cbc:TaxCurrencyCode>` : "",
    el("BuyerReference", reference),
    period ? `<cac:InvoicePeriod>${el("StartDate", period.from)}${el("EndDate", period.to)}</cac:InvoicePeriod>` : "",
    credit ? `<cac:BillingReference><cac:InvoiceDocumentReference>${el("ID", doc.invoiceNumber)}</cac:InvoiceDocumentReference></cac:BillingReference>` : "",
    sellerParty(doc.seller, sellerVat),
    buyerParty(doc, buyerVat),
    !credit ? paymentMeans(doc) : "",
    taxTotals(doc),
    "<cac:LegalMonetaryTotal>",
    `<cbc:LineExtensionAmount currencyID="${c}">${amount(doc.totals.subtotalMinor, c)}</cbc:LineExtensionAmount>`,
    `<cbc:TaxExclusiveAmount currencyID="${c}">${amount(doc.totals.subtotalMinor, c)}</cbc:TaxExclusiveAmount>`,
    `<cbc:TaxInclusiveAmount currencyID="${c}">${amount(total, c)}</cbc:TaxInclusiveAmount>`,
    `<cbc:PayableAmount currencyID="${c}">${amount(total, c)}</cbc:PayableAmount>`,
    "</cac:LegalMonetaryTotal>",
    ...doc.lines.map((l, i) => lineXml(l, i, doc, credit)),
    `</${root}>`,
  ].join("");
  return { ok: true, xml, fileName: einvoiceFileName(number, credit ? "credit_note" : "invoice") };
}
