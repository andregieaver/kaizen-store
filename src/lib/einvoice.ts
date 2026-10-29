import type { CreditNoteSnapshot } from "./credit-allocation";
import type { BucketBasis, OrderInvoiceSnapshot, SnapshotBucket, SnapshotBuyer, SnapshotSeller, SnapshotVatHome } from "./invoice-snapshot";
import { minorUnitDigits } from "./money";

/**
 * Invoices and credit notes as structured data (wave 13 unit C, D403): EN 16931 in UBL 2.1 with Peppol BIS Billing 3.0's customisation, made
 * from the document's frozen snapshot only (D159), never from the order: every amount is the snapshot's, put in its place. What the snapshot
 * cannot carry (a seller or buyer country, a seller VAT number where VAT was charged) or totals that would not add up as EN 16931's rules ask
 * (BR-CO-10, 13 to 16) are refused with the reason, so a file is never sent that a receiver must reject. Sending through a Peppol access point
 * is not part of this: the file is fetched by staff and the Admin API.
 */

export const CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
export const PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

export type EinvoiceProblem = "seller_country" | "buyer_country" | "seller_vat_number" | "totals" | "currency";
export type Einvoice = { ok: true; xml: string; fileName: string } | { ok: false; problems: EinvoiceProblem[] };

const NS = [
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
].join(" ");

/** Text safe inside an XML element or attribute. */
export function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minor units as the decimal amount UBL wants, with the currency's own decimals (BR-DEC: at most two). */
export function amount(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  if (digits === 0) return `${sign}${abs}`;
  const unit = 10 ** digits;
  return `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(digits, "0")}`;
}

/** A unit price: a line's net over its quantity, with up to six decimals so quantity × price rounds back to the line's net (BR-LIN-04). */
export function unitPrice(netMinor: number, quantity: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const exact = netMinor / 10 ** digits / quantity;
  return exact.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");
}

/** A rate as a percentage: 0.25 → "25", 0.125 → "12.5". */
const percent = (rate: number): string => String(Math.round(rate * 1_000_000) / 10_000);

/** The UNCL5305 VAT category of a bucket, by what the snapshot says the sale was (EN 16931 BT-118). */
export function vatCategory(basis: BucketBasis, rate: number, sellerRegistered: boolean): "S" | "Z" | "E" | "AE" | "O" {
  if (!sellerRegistered) return "O";
  if (basis === "reverse_charge") return "AE";
  if (basis === "exempt") return "E";
  return rate > 0 ? "S" : "Z";
}

const EXEMPTION: Partial<Record<"E" | "AE" | "O", { code: string; reason: string }>> = {
  AE: { code: "VATEX-EU-AE", reason: "Reverse charge" },
  O: { code: "VATEX-EU-O", reason: "Not subject to VAT" },
  E: { code: "VATEX-EU-132", reason: "Exempt from VAT" },
};

function taxCategory(tag: "ClassifiedTaxCategory" | "TaxCategory", category: string, rate: number, withReason: boolean): string {
  const exemption = EXEMPTION[category as "E" | "AE" | "O"];
  return [
    `<cac:${tag}>`,
    `<cbc:ID>${category}</cbc:ID>`,
    category === "O" ? "" : `<cbc:Percent>${percent(category === "S" ? rate : 0)}</cbc:Percent>`,
    withReason && exemption ? `<cbc:TaxExemptionReasonCode>${exemption.code}</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>${exemption.reason}</cbc:TaxExemptionReason>` : "",
    "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
    `</cac:${tag}>`,
  ].join("");
}

/** The electronic address scheme (EAS) of an organisation number by country, else the party's email (`EM`). */
function endpoint(country: string | null, orgNumber: string | null, email: string | null): { scheme: string; id: string } | null {
  const digits = (orgNumber ?? "").replace(/\D/g, "");
  if (digits) {
    if (country === "NO" && digits.length === 9) return { scheme: "0192", id: digits };
    if (country === "SE" && digits.length === 10) return { scheme: "0007", id: digits };
    if (country === "DK" && digits.length === 8) return { scheme: "0184", id: digits };
  }
  return email ? { scheme: "EM", id: email } : null;
}

/** The seller's one-string address split into its lines: the first is the street, a line like "0155 Oslo" the postal code and city. */
function sellerAddress(seller: SnapshotSeller): { street: string | null; postalCode: string | null; city: string | null } {
  const lines = (seller.address ?? "").split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean);
  const place = lines.length > 1 ? /^(\d{3,6})\s+(.+)$/.exec(lines[lines.length - 1]) : null;
  return { street: lines[0] ?? null, postalCode: place?.[1] ?? null, city: place?.[2] ?? null };
}

const el = (tag: string, value: string | null | undefined) => (value ? `<cbc:${tag}>${xmlText(value)}</cbc:${tag}>` : "");

function sellerParty(seller: SnapshotSeller, vatNumber: string | null): string {
  const at = sellerAddress(seller);
  const end = endpoint(seller.country, seller.organisationNumber, seller.email);
  return [
    "<cac:AccountingSupplierParty><cac:Party>",
    end ? `<cbc:EndpointID schemeID="${end.scheme}">${xmlText(end.id)}</cbc:EndpointID>` : "",
    seller.legalName ? `<cac:PartyName>${el("Name", seller.legalName)}</cac:PartyName>` : "",
    "<cac:PostalAddress>",
    el("StreetName", at.street),
    el("CityName", at.city),
    el("PostalZone", at.postalCode),
    `<cac:Country><cbc:IdentificationCode>${xmlText(seller.country ?? "")}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
    vatNumber ? `<cac:PartyTaxScheme>${el("CompanyID", vatNumber)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    "<cac:PartyLegalEntity>",
    el("RegistrationName", seller.legalName ?? ""),
    el("CompanyID", seller.organisationNumber),
    "</cac:PartyLegalEntity>",
    seller.email ? `<cac:Contact>${el("ElectronicMail", seller.email)}</cac:Contact>` : "",
    "</cac:Party></cac:AccountingSupplierParty>",
  ].join("");
}

function buyerParty(buyer: SnapshotBuyer, vatNumber: string | null): string {
  const a = buyer.address;
  const name = buyer.company || buyer.name || buyer.email;
  const end = endpoint(a.country, buyer.type === "business" ? buyer.organisationNumber : null, buyer.email);
  return [
    "<cac:AccountingCustomerParty><cac:Party>",
    end ? `<cbc:EndpointID schemeID="${end.scheme}">${xmlText(end.id)}</cbc:EndpointID>` : "",
    `<cac:PartyName>${el("Name", name)}</cac:PartyName>`,
    "<cac:PostalAddress>",
    el("StreetName", a.line1),
    el("AdditionalStreetName", a.line2),
    el("CityName", a.city),
    el("PostalZone", a.postalCode),
    `<cac:Country><cbc:IdentificationCode>${xmlText(a.country ?? "")}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
    vatNumber ? `<cac:PartyTaxScheme>${el("CompanyID", vatNumber)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    `<cac:PartyLegalEntity>${el("RegistrationName", name)}${buyer.type === "business" ? el("CompanyID", buyer.organisationNumber) : ""}</cac:PartyLegalEntity>`,
    `<cac:Contact>${el("ElectronicMail", buyer.email)}</cac:Contact>`,
    "</cac:Party></cac:AccountingCustomerParty>",
  ].join("");
}

/** The VAT breakdown (BG-23) from the snapshot's buckets, merged by category and rate, and the VAT in the seller's own currency where it differs (BT-111). */
function taxTotals(buckets: readonly SnapshotBucket[], currency: string, registered: boolean, vatHome: SnapshotVatHome | null, sign = 1): string {
  const merged = new Map<string, { category: string; rate: number; net: number; vat: number }>();
  for (const b of buckets) {
    const category = vatCategory(b.basis, b.rate, registered);
    const key = `${category}:${category === "S" ? b.rate : 0}`;
    const at = merged.get(key) ?? { category, rate: b.rate, net: 0, vat: 0 };
    at.net += b.netMinor;
    at.vat += b.vatMinor;
    merged.set(key, at);
  }
  const vat = buckets.reduce((s, b) => s + b.vatMinor, 0) * sign;
  const subtotals = [...merged.values()]
    .map(
      (m) =>
        `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${currency}">${amount(m.net * sign, currency)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${currency}">${amount(m.vat * sign, currency)}</cbc:TaxAmount>${taxCategory("TaxCategory", m.category, m.rate, true)}</cac:TaxSubtotal>`,
    )
    .join("");
  const home =
    vatHome && vatHome.currency !== currency
      ? `<cac:TaxTotal><cbc:TaxAmount currencyID="${vatHome.currency}">${amount(vatHome.vatMinor * sign, vatHome.currency)}</cbc:TaxAmount></cac:TaxTotal>`
      : "";
  return `<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${amount(vat, currency)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>${home}`;
}

function headProblems(doc: Pick<OrderInvoiceSnapshot, "seller" | "buyer" | "currency" | "buckets"> & { treatment: { sellerVatNumber: string | null } }): EinvoiceProblem[] {
  const problems: EinvoiceProblem[] = [];
  if (!/^[A-Z]{2}$/.test(doc.seller.country ?? "")) problems.push("seller_country");
  if (!/^[A-Z]{2}$/.test(doc.buyer.address.country ?? "")) problems.push("buyer_country");
  const charged = doc.buckets.some((b) => b.vatMinor > 0);
  if (charged && !(doc.treatment.sellerVatNumber ?? doc.seller.vatNumber)) problems.push("seller_vat_number");
  try {
    minorUnitDigits(doc.currency);
  } catch {
    problems.push("currency");
  }
  return problems;
}

/** The invoice's file name: its number, safe for a file. */
export const einvoiceFileName = (number: string, kind: "invoice" | "credit_note") => `${kind === "invoice" ? "invoice" : "credit-note"}-${number.replace(/[^A-Za-z0-9_-]+/g, "-")}.xml`;

/**
 * An order's invoice as EN 16931 UBL (D403). Lines are the snapshot's lines at their net after their own discounts; shipping is a document-level
 * charge in its VAT category; what was paid before (online, outside, by gift card, by an earlier invoice or a return's credit) is the prepaid
 * amount, and what is due (payment terms, at the venue) the payable one, with its due date.
 */
export function invoiceUbl(doc: OrderInvoiceSnapshot): Einvoice {
  const problems = headProblems(doc);
  if (problems.length > 0) return { ok: false, problems };
  const c = doc.currency;
  const registered = doc.seller.vatRegistered;
  const lines = doc.lines.filter((l) => l.quantity > 0);
  const lineSum = lines.reduce((s, l) => s + l.netMinor, 0);
  const charge = doc.shipping && doc.shipping.netMinor > 0 ? doc.shipping : null;
  const taxExclusive = lineSum + (charge?.netMinor ?? 0);
  const vat = doc.buckets.reduce((s, b) => s + b.vatMinor, 0);
  const prepaid = doc.payments.filter((p) => p.kind !== "due" && p.kind !== "pay_at_venue").reduce((s, p) => s + p.amountMinor, 0);
  const due = doc.payments.find((p) => p.kind === "due");
  const bucketNet = doc.buckets.reduce((s, b) => s + b.netMinor, 0);
  // BR-CO-10, 13, 14 and 15 on the snapshot's own figures: the lines and the charge are the buckets' net, the VAT their VAT, the total their sum.
  if (taxExclusive !== doc.totals.netMinor || bucketNet !== doc.totals.netMinor || vat !== doc.totals.vatMinor || taxExclusive + vat !== doc.totals.grossMinor || prepaid > doc.totals.grossMinor) {
    return { ok: false, problems: ["totals"] };
  }
  const sellerVat = doc.treatment.sellerVatNumber ?? doc.seller.vatNumber;
  const buyerVat = doc.treatment.buyerVatNumber ?? doc.buyer.vatNumber;
  const notes = doc.treatment.kind === "reverse_charge" ? "<cbc:Note>Reverse charge</cbc:Note>" : "";
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ${NS}>`,
    `<cbc:CustomizationID>${CUSTOMIZATION_ID}</cbc:CustomizationID>`,
    `<cbc:ProfileID>${PROFILE_ID}</cbc:ProfileID>`,
    el("ID", doc.number),
    el("IssueDate", doc.issuedOn),
    due?.dueOn ? el("DueDate", due.dueOn) : "",
    "<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>",
    notes,
    el("TaxPointDate", doc.supplyDate !== doc.issuedOn ? doc.supplyDate : null),
    `<cbc:DocumentCurrencyCode>${c}</cbc:DocumentCurrencyCode>`,
    doc.vatHome && doc.vatHome.currency !== c ? `<cbc:TaxCurrencyCode>${doc.vatHome.currency}</cbc:TaxCurrencyCode>` : "",
    `<cbc:BuyerReference>${xmlText(doc.poNumber ?? doc.order.number)}</cbc:BuyerReference>`,
    doc.poNumber ? `<cac:OrderReference>${el("ID", doc.poNumber)}</cac:OrderReference>` : "",
    sellerParty(doc.seller, sellerVat),
    buyerParty(doc.buyer, buyerVat),
    charge
      ? `<cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:AllowanceChargeReason>${xmlText(charge.label ?? "Shipping")}</cbc:AllowanceChargeReason><cbc:Amount currencyID="${c}">${amount(charge.netMinor, c)}</cbc:Amount>${taxCategory("TaxCategory", vatCategory(charge.basis, charge.vatRate, registered), charge.vatRate, false)}</cac:AllowanceCharge>`
      : "",
    taxTotals(doc.buckets, c, registered, doc.vatHome),
    "<cac:LegalMonetaryTotal>",
    `<cbc:LineExtensionAmount currencyID="${c}">${amount(lineSum, c)}</cbc:LineExtensionAmount>`,
    `<cbc:TaxExclusiveAmount currencyID="${c}">${amount(taxExclusive, c)}</cbc:TaxExclusiveAmount>`,
    `<cbc:TaxInclusiveAmount currencyID="${c}">${amount(doc.totals.grossMinor, c)}</cbc:TaxInclusiveAmount>`,
    charge ? `<cbc:ChargeTotalAmount currencyID="${c}">${amount(charge.netMinor, c)}</cbc:ChargeTotalAmount>` : "",
    prepaid > 0 ? `<cbc:PrepaidAmount currencyID="${c}">${amount(prepaid, c)}</cbc:PrepaidAmount>` : "",
    `<cbc:PayableAmount currencyID="${c}">${amount(doc.totals.grossMinor - prepaid, c)}</cbc:PayableAmount>`,
    "</cac:LegalMonetaryTotal>",
    ...lines.map((l, i) =>
      [
        "<cac:InvoiceLine>",
        `<cbc:ID>${i + 1}</cbc:ID>`,
        `<cbc:InvoicedQuantity unitCode="C62">${l.quantity}</cbc:InvoicedQuantity>`,
        `<cbc:LineExtensionAmount currencyID="${c}">${amount(l.netMinor, c)}</cbc:LineExtensionAmount>`,
        l.serviceDate ? `<cac:InvoicePeriod>${el("StartDate", l.serviceDate)}${el("EndDate", l.serviceDate)}</cac:InvoicePeriod>` : "",
        "<cac:Item>",
        el("Name", l.title || l.sku || "Item"),
        l.sku ? `<cac:SellersItemIdentification>${el("ID", l.sku)}</cac:SellersItemIdentification>` : "",
        taxCategory("ClassifiedTaxCategory", vatCategory(l.basis, l.vatRate, registered), l.vatRate, false),
        "</cac:Item>",
        `<cac:Price><cbc:PriceAmount currencyID="${c}">${unitPrice(l.netMinor, l.quantity, c)}</cbc:PriceAmount></cac:Price>`,
        "</cac:InvoiceLine>",
      ].join(""),
    ),
    "</Invoice>",
  ].join("");
  return { ok: true, xml, fileName: einvoiceFileName(doc.number, "invoice") };
}

/**
 * A credit note as EN 16931 UBL (D403): one line per VAT bucket of the note ("Credit for invoice …" at the bucket's rate and net), since a
 * credit note's rows carry their gross only and its VAT is its buckets'; the invoice it credits is the billing reference (BG-3).
 */
export function creditNoteUbl(doc: CreditNoteSnapshot): Einvoice {
  const problems = headProblems(doc);
  if (problems.length > 0) return { ok: false, problems };
  const c = doc.currency;
  const registered = doc.seller.vatRegistered;
  const buckets = doc.buckets.filter((b) => b.netMinor !== 0 || b.vatMinor !== 0);
  const net = buckets.reduce((s, b) => s + b.netMinor, 0);
  const vat = buckets.reduce((s, b) => s + b.vatMinor, 0);
  if (net !== doc.totals.netMinor || vat !== doc.totals.vatMinor || net + vat !== doc.totals.grossMinor) return { ok: false, problems: ["totals"] };
  const sellerVat = doc.treatment.sellerVatNumber ?? doc.seller.vatNumber;
  const buyerVat = doc.treatment.buyerVatNumber ?? doc.buyer.vatNumber;
  const label = `Credit for invoice ${doc.refersTo.invoiceNumber}`;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" ${NS}>`,
    `<cbc:CustomizationID>${CUSTOMIZATION_ID}</cbc:CustomizationID>`,
    `<cbc:ProfileID>${PROFILE_ID}</cbc:ProfileID>`,
    el("ID", doc.number),
    el("IssueDate", doc.issuedOn),
    "<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>",
    `<cbc:DocumentCurrencyCode>${c}</cbc:DocumentCurrencyCode>`,
    doc.vatHome && doc.vatHome.currency !== c ? `<cbc:TaxCurrencyCode>${doc.vatHome.currency}</cbc:TaxCurrencyCode>` : "",
    `<cbc:BuyerReference>${xmlText(doc.poNumber ?? doc.order.number)}</cbc:BuyerReference>`,
    `<cac:BillingReference><cac:InvoiceDocumentReference>${el("ID", doc.refersTo.invoiceNumber)}${el("IssueDate", doc.refersTo.invoiceIssuedOn)}</cac:InvoiceDocumentReference></cac:BillingReference>`,
    sellerParty(doc.seller, sellerVat),
    buyerParty(doc.buyer, buyerVat),
    taxTotals(buckets, c, registered, doc.vatHome),
    "<cac:LegalMonetaryTotal>",
    `<cbc:LineExtensionAmount currencyID="${c}">${amount(net, c)}</cbc:LineExtensionAmount>`,
    `<cbc:TaxExclusiveAmount currencyID="${c}">${amount(net, c)}</cbc:TaxExclusiveAmount>`,
    `<cbc:TaxInclusiveAmount currencyID="${c}">${amount(net + vat, c)}</cbc:TaxInclusiveAmount>`,
    `<cbc:PayableAmount currencyID="${c}">${amount(net + vat, c)}</cbc:PayableAmount>`,
    "</cac:LegalMonetaryTotal>",
    ...buckets.map((b, i) =>
      [
        "<cac:CreditNoteLine>",
        `<cbc:ID>${i + 1}</cbc:ID>`,
        '<cbc:CreditedQuantity unitCode="C62">1</cbc:CreditedQuantity>',
        `<cbc:LineExtensionAmount currencyID="${c}">${amount(b.netMinor, c)}</cbc:LineExtensionAmount>`,
        `<cac:Item>${el("Name", label)}${taxCategory("ClassifiedTaxCategory", vatCategory(b.basis, b.rate, registered), b.rate, false)}</cac:Item>`,
        `<cac:Price><cbc:PriceAmount currencyID="${c}">${amount(b.netMinor, c)}</cbc:PriceAmount></cac:Price>`,
        "</cac:CreditNoteLine>",
      ].join(""),
    ),
    "</CreditNote>",
  ].join("");
  return { ok: true, xml, fileName: einvoiceFileName(doc.number, "credit_note") };
}
