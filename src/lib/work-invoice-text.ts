/**
 * The wording of Work's legal documents (docs/work.md 4.5 and 4.8): document
 * labels, VAT notes, the late-payment note and credit-note wording, by the
 * language of the client's document.
 *
 * LEGAL REVIEW NEEDED. These texts were written by hand, conservatively, and
 * have NOT been reviewed by a lawyer or an accountant. A person must read
 * every line for Norway, Sweden and Denmark before any store issues a
 * document with them (WP0). Never machine-translate them and never add them
 * to `src/lib/i18n.ts`: that file feeds the AI translation catalogue (D111),
 * and legal wording must not be machine-made. Languages other than nb, sv, da
 * and en fall back to English.
 *
 * Deliberately a plain module of constants and small functions, so a
 * reviewer can read it top to bottom and the documents, emails and hosted
 * page all draw from one place.
 */

export const DOCUMENT_LANGUAGES = ["nb", "sv", "da", "en"] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

/** The statutory notes a VAT treatment puts on a document (`work-vat.ts` chooses which). */
export type VatNoteKey = "not_registered" | "reverse_charge" | "outside_scope" | "exempt";

/**
 * The language a document is written in, from its locale (`nb-NO`, `sv`,
 * `da_DK`): Norwegian in either written form (`nb`, `nn`, `no`) is Bokmål,
 * anything else this module has no text for is English.
 */
export function documentLanguage(locale: string | null | undefined): DocumentLanguage {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  if (base === "nb" || base === "nn" || base === "no") return "nb";
  if (base === "sv") return "sv";
  if (base === "da") return "da";
  return "en";
}

export type DocumentLabels = {
  invoice: string;
  creditNote: string;
  documentNumber: string;
  issueDate: string;
  dueDate: string;
  servicePeriod: string;
  from: string;
  billTo: string;
  organisationNumber: string;
  vatNumber: string;
  yourReference: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vatRate: string;
  amountExclVat: string;
  subtotalExclVat: string;
  vat: string;
  totalInclVat: string;
  amountDue: string;
  vatSummary: string;
  vatBasis: string;
  vatInHomeCurrency: string;
  paymentDetails: string;
  bankAccount: string;
  bic: string;
  paymentReference: string;
  notes: string;
  reason: string;
  creditedInvoice: string;
  paid: string;
  hoursUnit: string;
  unitUnit: string;
  /** The small note on an invoice moved in from Kaizen Life (docs/work.md WP15). */
  importedNote: string;
};

const LABELS: Record<DocumentLanguage, DocumentLabels> = {
  en: {
    invoice: "Invoice",
    creditNote: "Credit note",
    documentNumber: "Number",
    issueDate: "Issue date",
    dueDate: "Due date",
    servicePeriod: "Period of supply",
    from: "From",
    billTo: "Bill to",
    organisationNumber: "Organisation no.",
    vatNumber: "VAT no.",
    yourReference: "Your reference",
    description: "Description",
    quantity: "Quantity",
    unitPrice: "Unit price excl. VAT",
    discount: "Discount",
    vatRate: "VAT rate",
    amountExclVat: "Amount excl. VAT",
    subtotalExclVat: "Total excl. VAT",
    vat: "VAT",
    totalInclVat: "Total incl. VAT",
    amountDue: "Amount due",
    vatSummary: "VAT summary",
    vatBasis: "Net amount",
    vatInHomeCurrency: "VAT in {currency}",
    paymentDetails: "Payment details",
    bankAccount: "Bank account",
    bic: "BIC/SWIFT",
    paymentReference: "Payment reference",
    notes: "Notes",
    reason: "Reason",
    creditedInvoice: "Credited invoice",
    paid: "Paid",
    hoursUnit: "h",
    unitUnit: "pcs",
    importedNote: "Imported from Kaizen Life",
  },
  nb: {
    invoice: "Faktura",
    creditNote: "Kreditnota",
    documentNumber: "Nummer",
    issueDate: "Fakturadato",
    dueDate: "Forfallsdato",
    servicePeriod: "Leveringsperiode",
    from: "Fra",
    billTo: "Faktureres til",
    organisationNumber: "Org.nr.",
    vatNumber: "MVA-nr.",
    yourReference: "Deres referanse",
    description: "Beskrivelse",
    quantity: "Antall",
    unitPrice: "Enhetspris ekskl. mva.",
    discount: "Rabatt",
    vatRate: "MVA-sats",
    amountExclVat: "Beløp ekskl. mva.",
    subtotalExclVat: "Sum ekskl. mva.",
    vat: "MVA",
    totalInclVat: "Sum inkl. mva.",
    amountDue: "Å betale",
    vatSummary: "MVA-oversikt",
    vatBasis: "Grunnlag",
    vatInHomeCurrency: "MVA i {currency}",
    paymentDetails: "Betalingsopplysninger",
    bankAccount: "Kontonummer",
    bic: "BIC/SWIFT",
    paymentReference: "Betalingsreferanse",
    notes: "Merknader",
    reason: "Årsak",
    creditedInvoice: "Kreditert faktura",
    paid: "Betalt",
    hoursUnit: "t",
    unitUnit: "stk",
    importedNote: "Importert fra Kaizen Life",
  },
  sv: {
    invoice: "Faktura",
    creditNote: "Kreditfaktura",
    documentNumber: "Nummer",
    issueDate: "Fakturadatum",
    dueDate: "Förfallodatum",
    servicePeriod: "Leveransperiod",
    from: "Från",
    billTo: "Faktureras till",
    organisationNumber: "Organisationsnr",
    vatNumber: "Momsregistreringsnr",
    yourReference: "Er referens",
    description: "Beskrivning",
    quantity: "Antal",
    unitPrice: "À-pris exkl. moms",
    discount: "Rabatt",
    vatRate: "Momssats",
    amountExclVat: "Belopp exkl. moms",
    subtotalExclVat: "Summa exkl. moms",
    vat: "Moms",
    totalInclVat: "Summa inkl. moms",
    amountDue: "Att betala",
    vatSummary: "Momsspecifikation",
    vatBasis: "Underlag",
    vatInHomeCurrency: "Moms i {currency}",
    paymentDetails: "Betalningsuppgifter",
    bankAccount: "Bankkonto",
    bic: "BIC/SWIFT",
    paymentReference: "Betalningsreferens",
    notes: "Anmärkningar",
    reason: "Orsak",
    creditedInvoice: "Krediterad faktura",
    paid: "Betald",
    hoursUnit: "tim",
    unitUnit: "st",
    importedNote: "Importerad från Kaizen Life",
  },
  da: {
    invoice: "Faktura",
    creditNote: "Kreditnota",
    documentNumber: "Nummer",
    issueDate: "Fakturadato",
    dueDate: "Forfaldsdato",
    servicePeriod: "Leveringsperiode",
    from: "Fra",
    billTo: "Faktureres til",
    organisationNumber: "CVR-nr.",
    vatNumber: "Momsnr.",
    yourReference: "Jeres reference",
    description: "Beskrivelse",
    quantity: "Antal",
    unitPrice: "Enhedspris ekskl. moms",
    discount: "Rabat",
    vatRate: "Momssats",
    amountExclVat: "Beløb ekskl. moms",
    subtotalExclVat: "I alt ekskl. moms",
    vat: "Moms",
    totalInclVat: "I alt inkl. moms",
    amountDue: "At betale",
    vatSummary: "Momsoversigt",
    vatBasis: "Grundlag",
    vatInHomeCurrency: "Moms i {currency}",
    paymentDetails: "Betalingsoplysninger",
    bankAccount: "Bankkonto",
    bic: "BIC/SWIFT",
    paymentReference: "Betalingsreference",
    notes: "Bemærkninger",
    reason: "Årsag",
    creditedInvoice: "Krediteret faktura",
    paid: "Betalt",
    hoursUnit: "t",
    unitUnit: "stk",
    importedNote: "Importeret fra Kaizen Life",
  },
};

/** The labels of a document in its language. */
export function documentLabels(language: DocumentLanguage): DocumentLabels {
  return LABELS[language] ?? LABELS.en;
}

/** "VAT in NOK" for the label that states VAT in the seller's own currency (4.5 6). */
export function vatInCurrencyLabel(language: DocumentLanguage, currency: string): string {
  return documentLabels(language).vatInHomeCurrency.replace("{currency}", currency);
}

const VAT_NOTES: Record<VatNoteKey, Record<DocumentLanguage, string>> = {
  not_registered: {
    en: "VAT is not charged: the seller is not registered for VAT.",
    nb: "Selger er ikke registrert i Merverdiavgiftsregisteret. Merverdiavgift er ikke beregnet.",
    sv: "Moms debiteras inte: säljaren är inte momsregistrerad.",
    da: "Der er ikke opkrævet moms: sælger er ikke momsregistreret.",
  },
  reverse_charge: {
    en: "Reverse charge: VAT is to be accounted for by the recipient.",
    nb: "Omvendt avgiftsplikt: kjøper beregner og betaler merverdiavgiften.",
    sv: "Omvänd betalningsskyldighet: köparen redovisar momsen.",
    da: "Omvendt betalingspligt: køber beregner og afregner momsen.",
  },
  outside_scope: {
    en: "Outside the scope of VAT: the supply is made to a customer outside the seller's VAT territory.",
    nb: "Utenfor merverdiavgiftsområdet: tjenesten leveres til en kjøper utenfor avgiftsområdet.",
    sv: "Utanför tillämpningsområdet för moms: tjänsten säljs till en köpare utanför säljarens momsområde.",
    da: "Uden for momsområdet: ydelsen leveres til en køber uden for sælgers momsområde.",
  },
  exempt: {
    en: "Exempt from VAT.",
    nb: "Fritatt for merverdiavgift.",
    sv: "Undantaget från moms.",
    da: "Fritaget for moms.",
  },
};

/** The citation added to a reverse-charge note when the seller is in the EU (Article 196 of the VAT Directive). */
const EU_REVERSE_CHARGE_CITATION: Record<DocumentLanguage, string> = {
  en: "Article 196, Council Directive 2006/112/EC.",
  nb: "Artikkel 196, direktiv 2006/112/EF.",
  sv: "Artikel 196, rådets direktiv 2006/112/EG.",
  da: "Artikel 196, Rådets direktiv 2006/112/EF.",
};

/**
 * The statutory note for a VAT treatment, in the document's language. The
 * seller's country matters only for the reverse charge: a seller in the EU
 * cites the VAT Directive, a seller outside it (Norway) does not.
 */
export function vatNoteText(
  key: VatNoteKey,
  language: DocumentLanguage,
  options: { sellerInEu?: boolean } = {},
): string {
  const text = VAT_NOTES[key][language] ?? VAT_NOTES[key].en;
  if (key === "reverse_charge" && options.sellerInEu) return `${text} ${EU_REVERSE_CHARGE_CITATION[language]}`;
  return text;
}

const LATE_PAYMENT: Record<DocumentLanguage, string> = {
  en: "Interest may be charged on overdue amounts as provided by law.",
  nb: "Ved forsinket betaling kan det kreves forsinkelsesrente etter forsinkelsesrenteloven.",
  sv: "Vid försenad betalning kan dröjsmålsränta tas ut enligt räntelagen.",
  da: "Ved for sen betaling kan der beregnes morarenter efter renteloven.",
};

/**
 * The late-payment note used until the owner writes their own
 * (`work_settings.late_payment_note`). It names no rate and no fee: Work
 * never adds interest or collection charges by itself (4.5 10).
 */
export function defaultLatePaymentNote(language: DocumentLanguage): string {
  return LATE_PAYMENT[language] ?? LATE_PAYMENT.en;
}

/** What a credit note says about the invoice it corrects. */
export function creditNoteWording(
  language: DocumentLanguage,
  args: { invoiceNumber: string; full: boolean },
): { title: string; statement: string; settlement: string } {
  const n = args.invoiceNumber;
  const words: Record<DocumentLanguage, { full: string; partial: string; settlement: string }> = {
    en: {
      full: `This credit note cancels invoice ${n} in full.`,
      partial: `This credit note credits part of invoice ${n}.`,
      settlement: "Amounts already paid are settled separately.",
    },
    nb: {
      full: `Denne kreditnotaen krediterer faktura ${n} i sin helhet.`,
      partial: `Denne kreditnotaen krediterer en del av faktura ${n}.`,
      settlement: "Beløp som allerede er betalt, gjøres opp særskilt.",
    },
    sv: {
      full: `Denna kreditfaktura krediterar faktura ${n} i sin helhet.`,
      partial: `Denna kreditfaktura krediterar en del av faktura ${n}.`,
      settlement: "Belopp som redan har betalats regleras separat.",
    },
    da: {
      full: `Denne kreditnota krediterer faktura ${n} i sin helhed.`,
      partial: `Denne kreditnota krediterer en del af faktura ${n}.`,
      settlement: "Beløb, der allerede er betalt, afregnes særskilt.",
    },
  };
  const w = words[language] ?? words.en;
  return {
    title: documentLabels(language).creditNote,
    statement: args.full ? w.full : w.partial,
    settlement: w.settlement,
  };
}

/**
 * The informational zero line that shows hours paid in advance (6.4), so the
 * statement adds up for the client: "12 h paid in advance (order 1042)".
 */
export function prepaidCoverageText(language: DocumentLanguage, args: { hours: string; orders: string[] }): string {
  const orders = args.orders.join(", ");
  const suffix = orders ? ` (${orders})` : "";
  switch (language) {
    case "nb":
      return `${args.hours} forhåndsbetalt${suffix}`;
    case "sv":
      return `${args.hours} förskottsbetalda${suffix}`;
    case "da":
      return `${args.hours} forudbetalt${suffix}`;
    default:
      return `${args.hours} paid in advance${suffix}`;
  }
}

/**
 * The payment terms line of an invoice: "Payment terms: 14 days net". Written
 * by hand like the rest of this module and equally unreviewed (see the top).
 */
export function paymentTermsText(language: DocumentLanguage, days: number): string {
  switch (language) {
    case "nb":
      return `Betalingsbetingelser: ${days} dager netto`;
    case "sv":
      return `Betalningsvillkor: ${days} dagar netto`;
    case "da":
      return `Betalingsbetingelser: ${days} dage netto`;
    default:
      return `Payment terms: ${days} days net`;
  }
}
