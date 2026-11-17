/**
 * The words a contract's document prints around what the owner wrote (D695): the parties, the quote's table and the signature boxes. In
 * the contract's own language, written by hand for Norwegian bokmål and English (the starters' languages); any other falls back to
 * English, as the template it was written from will be in the owner's words anyway. Pure.
 */

export type ContractText = {
  between: string;
  supplier: string;
  customer: string;
  orgNumber: string;
  item: string;
  quantity: string;
  unitPrice: string;
  total: string;
  totalAll: string;
  signatures: string;
  forStore: string;
  forCustomer: string;
  name: string;
  date: string;
  signature: string;
  audit: {
    title: string;
    intro: string;
    contract: string;
    document: string;
    sentAt: string;
    completedAt: string;
    signers: string;
    signedName: string;
    signedAt: string;
    method: string;
    methods: { email_code: string; admin_session: string };
    from: string;
    events: string;
    kinds: Record<"sent" | "viewed" | "code_sent" | "code_checked" | "signed" | "declined" | "reminded" | "completed" | "expired" | "cancelled", string>;
    seal: string;
  };
};

const nb: ContractText = {
  between: "Parter",
  supplier: "Leverandør",
  customer: "Kunde",
  orgNumber: "Org.nr.",
  item: "Beskrivelse",
  quantity: "Antall",
  unitPrice: "Pris",
  total: "Sum",
  totalAll: "Totalt",
  signatures: "Signaturer",
  forStore: "For leverandøren",
  forCustomer: "For kunden",
  name: "Navn",
  date: "Dato",
  signature: "Signatur",
  audit: {
    title: "Signeringslogg",
    intro: "Denne siden er lagt til etter at alle signerte. Sidene foran er kontrakten slik den ble sendt; fingeravtrykket under er dens SHA-256.",
    contract: "Kontrakt",
    document: "Dokumentets SHA-256 (slik det ble sendt)",
    sentAt: "Sendt",
    completedAt: "Signert av alle",
    signers: "Hvem som signerte",
    signedName: "Navn skrevet",
    signedAt: "Tidspunkt",
    method: "Hvordan",
    methods: { email_code: "Kode sendt til e-post", admin_session: "Pålogget i butikkens administrasjon" },
    from: "Fra",
    events: "Hendelser",
    kinds: {
      sent: "Sendt",
      viewed: "Åpnet",
      code_sent: "Kode sendt",
      code_checked: "Kode bekreftet",
      signed: "Signert",
      declined: "Avslått",
      reminded: "Påminnet",
      completed: "Signert av alle",
      expired: "Utløpt",
      cancelled: "Kansellert",
    },
    seal: "Filen er beseglet av Kaizena Flow etter siste signatur, slik at en endring vises når den åpnes. Seglets fingeravtrykk:",
  },
};

const en: ContractText = {
  between: "Parties",
  supplier: "Supplier",
  customer: "Customer",
  orgNumber: "Company no.",
  item: "Description",
  quantity: "Qty",
  unitPrice: "Price",
  total: "Amount",
  totalAll: "Total",
  signatures: "Signatures",
  forStore: "For the supplier",
  forCustomer: "For the customer",
  name: "Name",
  date: "Date",
  signature: "Signature",
  audit: {
    title: "Signing record",
    intro: "This page was added after everyone signed. The pages before it are the contract as it was sent; the fingerprint below is its SHA-256.",
    contract: "Contract",
    document: "The document's SHA-256 (as sent)",
    sentAt: "Sent",
    completedAt: "Signed by all",
    signers: "Who signed",
    signedName: "Name typed",
    signedAt: "Time",
    method: "How",
    methods: { email_code: "A code sent to their email", admin_session: "Signed in to the store's admin" },
    from: "From",
    events: "Events",
    kinds: {
      sent: "Sent",
      viewed: "Opened",
      code_sent: "Code sent",
      code_checked: "Code confirmed",
      signed: "Signed",
      declined: "Declined",
      reminded: "Reminded",
      completed: "Signed by all",
      expired: "Expired",
      cancelled: "Cancelled",
    },
    seal: "The file is sealed by Kaizena Flow after the last signature, so any change shows when it is opened. The seal's fingerprint:",
  },
};

export const contractText = (language: string): ContractText => (language.toLowerCase().split("-")[0] === "nb" ? nb : en);
