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
};

export const contractText = (language: string): ContractText => (language.toLowerCase().split("-")[0] === "nb" ? nb : en);
