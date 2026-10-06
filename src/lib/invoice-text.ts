/**
 * What an invoice, a credit note and the emails about them say (D159, `docs/wave-1b-invoices.md` 4.3 and 8).
 *
 * LEGAL TEXT. Hand-written in nb, sv, da and en, plain and careful, never machine-translated and never claimed to be legal advice.
 * It is deliberately not part of `i18n.ts`'s messages, so the AI catalogue (`ui-catalog.ts`) never sees it, and every other
 * language shows the English words. The reverse-charge and IOSS statements are the same words the order emails use
 * (`vatEmailText()`, D157). No string here puts a free-text field (a title, a name, a note) inside a statutory sentence: such
 * fields are printed on their own, as text.
 *
 * Needs review by an accountant or lawyer in each country before real use (docs/wave-1b-invoices.md section 8).
 */
import { vatEmailText } from "./email-text";
import type { BucketBasis } from "./invoice-snapshot";
import type { CreditRowKind } from "./credit-allocation";

export type DocumentLanguage = "nb" | "sv" | "da" | "en";

// legal: needs review
export type DocumentText = {
  invoice: string;
  creditNote: string;
  invoiceNumber: string;
  creditNoteNumber: string;
  issueDate: string;
  supplyDate: string;
  /** Under the dates: what the date of supply is. */
  supplyDateNote: string;
  /** The same for an invoice with nothing paid online (a booking paid at the venue): there is no payment day to date the supply by. */
  supplyDateNoteVenue: string;
  orderNumber: string;
  orderedOn: string;
  paidOn: string;
  seller: string;
  buyer: string;
  organisationNumber: string;
  vatNumber: string;
  sellerVatNumber: string;
  buyerVatNumber: string;
  email: string;
  deliveryPlace: string;
  description: string;
  quantity: string;
  unitPriceExVat: string;
  discountExVat: string;
  /** Column heads without a word about VAT, for a seller who is not registered for it and so may not indicate VAT (Denmark's momsloven 52 a). */
  unitPrice: string;
  discount: string;
  amount: string;
  amountExVat: string;
  vatRate: string;
  vatAmount: string;
  amountInclVat: string;
  shipping: string;
  booked: string;
  totalExVat: string;
  totalVat: string;
  /** A neutral total (never "to pay": the invoice is for a sale that is paid; what is left for the venue is its own payment line). */
  total: string;
  /** The total line of a credit note. */
  totalCredited: string;
  vatByRate: string;
  rate: string;
  taxableAmount: string;
  vat: string;
  basis: Record<BucketBasis, string>;
  payment: string;
  paidOnline: string;
  /** A payment the seller took outside the online checkout (wave 3, D173): said as it is, with how it was received, never as "paid online". */
  paidOutside: string;
  paymentMethods: Record<"cash" | "bank_transfer" | "other", string>;
  payAtVenue: string;
  discountsGiven: string;
  discountKinds: Record<"campaign" | "member" | "welcome" | "code" | "staff" | "credit", string>;
  /** The statements the law asks for; the first two are the order emails' own words. */
  reverseCharge: string;
  ioss: (number: string) => string;
  notRegistered: string;
  exempt: string;
  unitRounded: string;
  /** "VAT in Norwegian kroner: 1,234.56 NOK (rate 11.70 ..."; every part is a fact, never free text. */
  vatHome: (input: { currency: string; amount: string; fromCurrency: string; rate: string; asOf: string }) => string;
  deferredTitle: string;
  deferredNote: string;
  /** Credit notes. */
  refersTo: (number: string, date: string) => string;
  reasonRefund: string;
  reasonReturn: (returnNumber: string) => string;
  creditRows: Record<CreditRowKind, string>;
  position: { invoiceTotal: string; creditedBefore: string; creditedNow: string; leftOnInvoice: string };
  creditCapped: string;
  /** The hosted page and the order page. */
  downloadPdf: string;
  print: string;
  view: string;
  documents: string;
  invoiceLink: (number: string, date: string) => string;
  creditNoteLink: (number: string, date: string) => string;
  pdf: string;
  testOrder: string;
  page: string;
  of: string;
};

// legal: needs review
export type DocumentEmailText = {
  invoiceSubject: (number: string, store: string) => string;
  invoiceIntro: (orderNumber: string) => string;
  creditNoteSubject: (number: string, store: string) => string;
  creditNoteIntro: (orderNumber: string) => string;
  openInvoice: string;
  openCreditNote: string;
  pdfAttached: string;
  /** In the order confirmation, the shipped email and the refund email: a line with the document's number above its link. */
  yourInvoice: (number: string) => string;
  yourCreditNote: (number: string) => string;
  /** What the refund email says when the credit note is in the same email. */
  refundCreditNote: string;
};

const TEXT: Record<DocumentLanguage, Omit<DocumentText, "reverseCharge" | "ioss">> = {
  nb: {
    // legal: needs review
    invoice: "Faktura",
    creditNote: "Kreditnota",
    invoiceNumber: "Fakturanummer",
    creditNoteNumber: "Kreditnotanummer",
    issueDate: "Fakturadato",
    supplyDate: "Leveringsdato",
    supplyDateNote: "Leveringsdato er betalingsdagen; bestilte tjenester viser sine egne datoer.",
    supplyDateNoteVenue: "Bestilte tjenester viser sine egne datoer.",
    orderNumber: "Ordrenummer",
    orderedOn: "Bestilt",
    paidOn: "Betalt på nett",
    seller: "Selger",
    buyer: "Kjøper",
    organisationNumber: "Organisasjonsnummer",
    vatNumber: "Mva-nummer",
    sellerVatNumber: "Selgers mva-nr.",
    buyerVatNumber: "Kjøpers mva-nr.",
    email: "E-post",
    deliveryPlace: "Leveringssted",
    description: "Beskrivelse",
    quantity: "Antall",
    unitPriceExVat: "Enhetspris eks. mva.",
    discountExVat: "Rabatt eks. mva.",
    unitPrice: "Enhetspris",
    discount: "Rabatt",
    amount: "Beløp",
    amountExVat: "Beløp eks. mva.",
    vatRate: "Mva.-sats",
    vatAmount: "Mva.",
    amountInclVat: "Beløp inkl. mva.",
    shipping: "Frakt",
    booked: "Bestilt tid",
    totalExVat: "Sum eks. mva.",
    totalVat: "Mva.",
    total: "Totalt",
    totalCredited: "Kreditert totalt",
    vatByRate: "Mva. per sats",
    rate: "Sats",
    taxableAmount: "Grunnlag",
    vat: "Mva.",
    basis: { standard: "Med mva.", exempt: "Fritatt for mva.", reverse_charge: "Omvendt avgiftsplikt", ioss: "IOSS" },
    payment: "Betaling",
    paidOnline: "Betalt på nett",
    paidOutside: "Betalt utenfor nettbutikken",
    paymentMethods: { cash: "kontant", bank_transfer: "bankoverføring", other: "på annen måte" },
    payAtVenue: "Betales på stedet",
    discountsGiven: "Rabatter gitt (inkl. mva.)",
    discountKinds: { campaign: "Kampanje", member: "Kundegruppe", welcome: "Velkomstrabatt", code: "Rabattkode", staff: "Rabatt gitt av butikken", credit: "Bonuspoeng" },
    notRegistered: "Selgeren er ikke registrert i Merverdiavgiftsregisteret, og det er derfor ikke oppgitt mva.",
    exempt: "Fritatt for mva.",
    unitRounded: "Enhetsprisene er avrundet for visning. Beløpet på hver linje er nøyaktig.",
    vatHome: ({ currency, amount, fromCurrency, rate, asOf }) => `Mva. i ${currency}: ${amount} (kurs ${rate} ${currency} per ${fromCurrency}, ${asOf})`,
    deferredTitle: "Ikke på denne fakturaen",
    deferredNote: "Faktureres ved første fornyelse, på egen faktura.",
    refersTo: (number, date) => `Denne kreditnotaen gjelder faktura ${number} av ${date}.`,
    reasonRefund: "Refusjon",
    reasonReturn: (n) => `Retur ${n}: refusjon`,
    creditRows: { refund: "Refusjon", goods: "Returnerte varer", deduction: "Fradrag for redusert verdi", delivery: "Frakt refundert", return_shipping: "Returfrakt betalt av kjøper", adjustment: "Justering" },
    position: { invoiceTotal: "Fakturaens sum", creditedBefore: "Kreditert tidligere", creditedNow: "Kreditert på denne kreditnotaen", leftOnInvoice: "Igjen på fakturaen" },
    creditCapped: "Refusjonen var større enn det som var igjen på fakturaen. Kreditnotaen gjelder det som var igjen.",
    downloadPdf: "Last ned PDF",
    print: "Skriv ut",
    view: "Vis",
    documents: "Dokumenter",
    invoiceLink: (number, date) => `Faktura ${number}, ${date}`,
    creditNoteLink: (number, date) => `Kreditnota ${number}, ${date}`,
    pdf: "PDF",
    testOrder: "Testbestilling: ingen faktura.",
    page: "Side",
    of: "av",
  },
  sv: {
    // legal: needs review
    invoice: "Faktura",
    creditNote: "Kreditfaktura",
    invoiceNumber: "Fakturanummer",
    creditNoteNumber: "Kreditfakturanummer",
    issueDate: "Fakturadatum",
    supplyDate: "Leveransdatum",
    supplyDateNote: "Leveransdatum är betalningsdagen; bokade tjänster visar sina egna datum.",
    supplyDateNoteVenue: "Bokade tjänster visar sina egna datum.",
    orderNumber: "Ordernummer",
    orderedOn: "Beställd",
    paidOn: "Betalt online",
    seller: "Säljare",
    buyer: "Köpare",
    organisationNumber: "Organisationsnummer",
    vatNumber: "Momsnummer",
    sellerVatNumber: "Säljarens momsnummer",
    buyerVatNumber: "Köparens momsnummer",
    email: "E-post",
    deliveryPlace: "Leveransort",
    description: "Beskrivning",
    quantity: "Antal",
    unitPriceExVat: "À-pris exkl. moms",
    discountExVat: "Rabatt exkl. moms",
    unitPrice: "Enhetspris",
    discount: "Rabatt",
    amount: "Belopp",
    amountExVat: "Belopp exkl. moms",
    vatRate: "Momssats",
    vatAmount: "Moms",
    amountInclVat: "Belopp inkl. moms",
    shipping: "Frakt",
    booked: "Bokad tid",
    totalExVat: "Summa exkl. moms",
    totalVat: "Moms",
    total: "Totalt",
    totalCredited: "Krediterat totalt",
    vatByRate: "Moms per momssats",
    rate: "Sats",
    taxableAmount: "Underlag",
    vat: "Moms",
    basis: { standard: "Med moms", exempt: "Momsfri", reverse_charge: "Omvänd skattskyldighet", ioss: "IOSS" },
    payment: "Betalning",
    paidOnline: "Betalt online",
    paidOutside: "Betalt utanför webbutiken",
    paymentMethods: { cash: "kontant", bank_transfer: "banköverföring", other: "på annat sätt" },
    payAtVenue: "Betalas på plats",
    discountsGiven: "Rabatter som getts (inkl. moms)",
    discountKinds: { campaign: "Kampanj", member: "Kundgrupp", welcome: "Välkomstrabatt", code: "Rabattkod", staff: "Rabatt från butiken", credit: "Bonuspoäng" },
    notRegistered: "Säljaren är inte registrerad för moms, och därför anges ingen moms.",
    exempt: "Undantaget från moms.",
    unitRounded: "À-priserna är avrundade för visning. Beloppet på varje rad är exakt.",
    vatHome: ({ currency, amount, fromCurrency, rate, asOf }) => `Moms i ${currency}: ${amount} (kurs ${rate} ${currency} per ${fromCurrency}, ${asOf})`,
    deferredTitle: "Inte på denna faktura",
    deferredNote: "Faktureras vid första förnyelsen, på en egen faktura.",
    refersTo: (number, date) => `Denna kreditfaktura avser faktura ${number} av ${date}.`,
    reasonRefund: "Återbetalning",
    reasonReturn: (n) => `Retur ${n}: återbetalning`,
    creditRows: { refund: "Återbetalning", goods: "Returnerade varor", deduction: "Avdrag för minskat värde", delivery: "Frakt återbetald", return_shipping: "Returfrakt betald av köparen", adjustment: "Justering" },
    position: { invoiceTotal: "Fakturans summa", creditedBefore: "Krediterat tidigare", creditedNow: "Krediterat på denna kreditfaktura", leftOnInvoice: "Kvar på fakturan" },
    creditCapped: "Återbetalningen var större än vad som fanns kvar på fakturan. Kreditfakturan avser det som fanns kvar.",
    downloadPdf: "Ladda ner PDF",
    print: "Skriv ut",
    view: "Visa",
    documents: "Dokument",
    invoiceLink: (number, date) => `Faktura ${number}, ${date}`,
    creditNoteLink: (number, date) => `Kreditfaktura ${number}, ${date}`,
    pdf: "PDF",
    testOrder: "Testbeställning: ingen faktura.",
    page: "Sida",
    of: "av",
  },
  da: {
    // legal: needs review
    invoice: "Faktura",
    creditNote: "Kreditnota",
    invoiceNumber: "Fakturanummer",
    creditNoteNumber: "Kreditnotanummer",
    issueDate: "Fakturadato",
    supplyDate: "Leveringsdato",
    supplyDateNote: "Leveringsdatoen er betalingsdagen; bookede ydelser viser deres egne datoer.",
    supplyDateNoteVenue: "Bookede ydelser viser deres egne datoer.",
    orderNumber: "Ordrenummer",
    orderedOn: "Bestilt",
    paidOn: "Betalt online",
    seller: "Sælger",
    buyer: "Køber",
    organisationNumber: "CVR- eller organisationsnummer",
    vatNumber: "Momsnummer",
    sellerVatNumber: "Sælgers momsnr.",
    buyerVatNumber: "Købers momsnr.",
    email: "E-mail",
    deliveryPlace: "Leveringssted",
    description: "Beskrivelse",
    quantity: "Antal",
    unitPriceExVat: "Stykpris ekskl. moms",
    discountExVat: "Rabat ekskl. moms",
    unitPrice: "Enhedspris",
    discount: "Rabat",
    amount: "Beløb",
    amountExVat: "Beløb ekskl. moms",
    vatRate: "Momssats",
    vatAmount: "Moms",
    amountInclVat: "Beløb inkl. moms",
    shipping: "Fragt",
    booked: "Booket tid",
    totalExVat: "I alt ekskl. moms",
    totalVat: "Moms",
    total: "I alt",
    totalCredited: "Krediteret i alt",
    vatByRate: "Moms pr. sats",
    rate: "Sats",
    taxableAmount: "Momsgrundlag",
    vat: "Moms",
    basis: { standard: "Med moms", exempt: "Momsfri", reverse_charge: "Omvendt betalingspligt", ioss: "IOSS" },
    payment: "Betaling",
    paidOnline: "Betalt online",
    paidOutside: "Betalt uden for webshoppen",
    paymentMethods: { cash: "kontant", bank_transfer: "bankoverførsel", other: "på anden måde" },
    payAtVenue: "Betales på stedet",
    discountsGiven: "Givne rabatter (inkl. moms)",
    discountKinds: { campaign: "Kampagne", member: "Kundegruppe", welcome: "Velkomstrabat", code: "Rabatkode", staff: "Rabat fra butikken", credit: "Bonuspoint" },
    notRegistered: "Sælgeren er ikke momsregistreret, og der er derfor ikke angivet moms.",
    exempt: "Momsfri.",
    unitRounded: "Stykpriserne er afrundet til visning. Beløbet på hver linje er nøjagtigt.",
    vatHome: ({ currency, amount, fromCurrency, rate, asOf }) => `Moms i ${currency}: ${amount} (kurs ${rate} ${currency} pr. ${fromCurrency}, ${asOf})`,
    deferredTitle: "Ikke på denne faktura",
    deferredNote: "Faktureres ved første fornyelse, på en særskilt faktura.",
    refersTo: (number, date) => `Denne kreditnota vedrører faktura ${number} af ${date}.`,
    reasonRefund: "Refusion",
    reasonReturn: (n) => `Retur ${n}: refusion`,
    creditRows: { refund: "Refusion", goods: "Returnerede varer", deduction: "Fradrag for forringet værdi", delivery: "Fragt refunderet", return_shipping: "Returfragt betalt af køber", adjustment: "Regulering" },
    position: { invoiceTotal: "Fakturaens sum", creditedBefore: "Krediteret tidligere", creditedNow: "Krediteret på denne kreditnota", leftOnInvoice: "Tilbage på fakturaen" },
    creditCapped: "Refusionen var større end det, der var tilbage på fakturaen. Kreditnotaen vedrører det, der var tilbage.",
    downloadPdf: "Hent PDF",
    print: "Udskriv",
    view: "Vis",
    documents: "Dokumenter",
    invoiceLink: (number, date) => `Faktura ${number}, ${date}`,
    creditNoteLink: (number, date) => `Kreditnota ${number}, ${date}`,
    pdf: "PDF",
    testOrder: "Testordre: ingen faktura.",
    page: "Side",
    of: "af",
  },
  en: {
    // legal: needs review
    invoice: "Invoice",
    creditNote: "Credit note",
    invoiceNumber: "Invoice number",
    creditNoteNumber: "Credit note number",
    issueDate: "Date of issue",
    supplyDate: "Date of supply",
    supplyDateNote: "The date of supply is the payment date; booked services show their own dates.",
    supplyDateNoteVenue: "Booked services show their own dates.",
    orderNumber: "Order number",
    orderedOn: "Ordered",
    paidOn: "Paid online",
    seller: "Seller",
    buyer: "Customer",
    organisationNumber: "Organisation number",
    vatNumber: "VAT number",
    sellerVatNumber: "Seller's VAT number",
    buyerVatNumber: "Buyer's VAT number",
    email: "Email",
    deliveryPlace: "Place of delivery",
    description: "Description",
    quantity: "Quantity",
    unitPriceExVat: "Unit price excl. VAT",
    discountExVat: "Discount excl. VAT",
    unitPrice: "Unit price",
    discount: "Discount",
    amount: "Amount",
    amountExVat: "Amount excl. VAT",
    vatRate: "VAT rate",
    vatAmount: "VAT",
    amountInclVat: "Amount incl. VAT",
    shipping: "Shipping",
    booked: "Booked",
    totalExVat: "Total excl. VAT",
    totalVat: "VAT",
    total: "Total",
    totalCredited: "Total credited",
    vatByRate: "VAT by rate",
    rate: "Rate",
    taxableAmount: "Taxable amount",
    vat: "VAT",
    basis: { standard: "With VAT", exempt: "Exempt from VAT", reverse_charge: "Reverse charge", ioss: "IOSS" },
    payment: "Payment",
    paidOnline: "Paid online",
    paidOutside: "Paid outside the online checkout",
    paymentMethods: { cash: "cash", bank_transfer: "bank transfer", other: "another way" },
    payAtVenue: "To pay at the venue",
    discountsGiven: "Discounts given (incl. VAT)",
    discountKinds: { campaign: "Campaign", member: "Customer group", welcome: "Welcome discount", code: "Discount code", staff: "Discount given by the store", credit: "Bonus credits" },
    notRegistered: "The seller is not registered for VAT, so no VAT is stated.",
    exempt: "Exempt from VAT.",
    unitRounded: "Unit prices are rounded for display. The amount on each line is exact.",
    vatHome: ({ currency, amount, fromCurrency, rate, asOf }) => `VAT in ${currency}: ${amount} (rate ${rate} ${currency} per ${fromCurrency}, ${asOf})`,
    deferredTitle: "Not on this invoice",
    deferredNote: "Billed at the first renewal, on an invoice of its own.",
    refersTo: (number, date) => `This credit note refers to invoice ${number} of ${date}.`,
    reasonRefund: "Refund",
    reasonReturn: (n) => `Return ${n}: refund`,
    creditRows: { refund: "Refund", goods: "Returned goods", deduction: "Deduction for diminished value", delivery: "Delivery refunded", return_shipping: "Return shipping paid by the customer", adjustment: "Adjustment" },
    position: { invoiceTotal: "Invoice total", creditedBefore: "Credited earlier", creditedNow: "Credited on this credit note", leftOnInvoice: "Left on the invoice" },
    creditCapped: "The refund was more than was left on the invoice. This credit note covers what was left.",
    downloadPdf: "Download PDF",
    print: "Print",
    view: "View",
    documents: "Documents",
    invoiceLink: (number, date) => `Invoice ${number}, ${date}`,
    creditNoteLink: (number, date) => `Credit note ${number}, ${date}`,
    pdf: "PDF",
    testOrder: "Test order: no invoice.",
    page: "Page",
    of: "of",
  },
};

/** The document's wording in a language: nb, sv, da or en by hand, English for every other language (never machine-translated). */
export function documentText(lang: string): DocumentText {
  const own = lang in TEXT ? TEXT[lang as DocumentLanguage] : TEXT.en;
  const vat = vatEmailText(lang);
  return { ...own, reverseCharge: vat.reverseCharge, ioss: vat.ioss };
}

const EMAIL: Record<DocumentLanguage, DocumentEmailText> = {
  nb: {
    // legal: needs review
    invoiceSubject: (number, store) => `Din faktura ${number} fra ${store}`,
    invoiceIntro: (order) => `Her er fakturaen for bestilling ${order}. Du kan åpne den, laste den ned som PDF og skrive den ut:`,
    creditNoteSubject: (number, store) => `Din kreditnota ${number} fra ${store}`,
    creditNoteIntro: (order) => `Her er kreditnotaen for refusjonen på bestilling ${order}. Du kan åpne den, laste den ned som PDF og skrive den ut:`,
    openInvoice: "Åpne fakturaen",
    openCreditNote: "Åpne kreditnotaen",
    pdfAttached: "PDF-filen ligger vedlagt.",
    yourInvoice: (number) => `Din faktura ${number}`,
    yourCreditNote: (number) => `Din kreditnota ${number}`,
    refundCreditNote: "Kreditnotaen for refusjonen finner du her:",
  },
  sv: {
    // legal: needs review
    invoiceSubject: (number, store) => `Din faktura ${number} från ${store}`,
    invoiceIntro: (order) => `Här är fakturan för beställning ${order}. Du kan öppna den, ladda ner den som PDF och skriva ut den:`,
    creditNoteSubject: (number, store) => `Din kreditfaktura ${number} från ${store}`,
    creditNoteIntro: (order) => `Här är kreditfakturan för återbetalningen på beställning ${order}. Du kan öppna den, ladda ner den som PDF och skriva ut den:`,
    openInvoice: "Öppna fakturan",
    openCreditNote: "Öppna kreditfakturan",
    pdfAttached: "PDF-filen är bifogad.",
    yourInvoice: (number) => `Din faktura ${number}`,
    yourCreditNote: (number) => `Din kreditfaktura ${number}`,
    refundCreditNote: "Kreditfakturan för återbetalningen hittar du här:",
  },
  da: {
    // legal: needs review
    invoiceSubject: (number, store) => `Din faktura ${number} fra ${store}`,
    invoiceIntro: (order) => `Her er fakturaen for bestilling ${order}. Du kan åbne den, hente den som PDF og udskrive den:`,
    creditNoteSubject: (number, store) => `Din kreditnota ${number} fra ${store}`,
    creditNoteIntro: (order) => `Her er kreditnotaen for refusionen på bestilling ${order}. Du kan åbne den, hente den som PDF og udskrive den:`,
    openInvoice: "Åbn fakturaen",
    openCreditNote: "Åbn kreditnotaen",
    pdfAttached: "PDF-filen er vedhæftet.",
    yourInvoice: (number) => `Din faktura ${number}`,
    yourCreditNote: (number) => `Din kreditnota ${number}`,
    refundCreditNote: "Kreditnotaen for refusionen finder du her:",
  },
  en: {
    // legal: needs review
    invoiceSubject: (number, store) => `Your invoice ${number} from ${store}`,
    invoiceIntro: (order) => `Here is the invoice for order ${order}. You can open it, download it as a PDF and print it:`,
    creditNoteSubject: (number, store) => `Your credit note ${number} from ${store}`,
    creditNoteIntro: (order) => `Here is the credit note for the refund of order ${order}. You can open it, download it as a PDF and print it:`,
    openInvoice: "Open the invoice",
    openCreditNote: "Open the credit note",
    pdfAttached: "The PDF is attached.",
    yourInvoice: (number) => `Your invoice ${number}`,
    yourCreditNote: (number) => `Your credit note ${number}`,
    refundCreditNote: "The credit note for the refund is here:",
  },
};

/** The emails' wording about documents: nb, sv, da or en by hand, English for every other language. */
export const documentEmailText = (lang: string): DocumentEmailText => (lang in EMAIL ? EMAIL[lang as DocumentLanguage] : EMAIL.en);

/** The four languages that are written by hand: the keys of both tables, which a test holds equal. */
export const DOCUMENT_LANGUAGES: readonly DocumentLanguage[] = ["nb", "sv", "da", "en"];

/** The statements an invoice carries, in the order they are printed, as sentences (the ones with a number are built here from facts only). */
export function treatmentStatements(
  lang: string,
  treatment: { statements: readonly string[]; sellerVatNumber: string | null; buyerVatNumber: string | null; iossNumber: string | null },
): { key: string; text: string }[] {
  const t = documentText(lang);
  const out: { key: string; text: string }[] = [];
  for (const s of treatment.statements) {
    if (s === "reverse_charge") {
      out.push({ key: s, text: t.reverseCharge });
    } else if (s === "ioss" && treatment.iossNumber) {
      out.push({ key: s, text: t.ioss(treatment.iossNumber) });
    } else if (s === "not_registered") {
      out.push({ key: s, text: t.notRegistered });
    } else if (s === "exempt") {
      out.push({ key: s, text: t.exempt });
    }
  }
  return out;
}
