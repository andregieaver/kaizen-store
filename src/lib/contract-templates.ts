import type { ContractBlock } from "./contract-fields";

/**
 * The template a store starts with (D695, `docs/contracts.md` 1): made on the first visit in the store's main language, so Homer can send
 * a contract without writing one. A short, plain agreement: who, what (the linked quote's lines, when there is one, or the deal's words),
 * payment, how to end it, the law, and the signatures. It is a starting point the owner edits, not legal advice, and says so in the admin.
 * Pure.
 */

type Starter = { name: string; blocks: ContractBlock[] };

const nb: Starter = {
  name: "Standard avtale",
  blocks: [
    { type: "heading", text: "{contract.title}" },
    {
      type: "paragraph",
      text: "Denne avtalen er inngått {contract.date} mellom {store.name} (org.nr. {store.org_number}), heretter «leverandøren», og {customer.name}, heretter «kunden».",
    },
    { type: "clause", id: "scope", title: "1. Hva avtalen gjelder", text: "Leverandøren leverer {deal.title} til kunden, som beskrevet nedenfor.", optional: false, included: true },
    { type: "quote_lines" },
    { type: "clause", id: "payment", title: "2. Betaling", text: "Kunden betaler mot faktura med 14 dagers betalingsfrist.", optional: false, included: true },
    {
      type: "clause",
      id: "confidentiality",
      title: "3. Taushetsplikt",
      text: "Partene holder opplysninger de får om hverandre under avtalen for seg selv, også etter at avtalen er slutt.",
      optional: true,
      included: true,
    },
    { type: "clause", id: "ending", title: "4. Oppsigelse", text: "Hver av partene kan si opp avtalen skriftlig med 30 dagers varsel.", optional: false, included: true },
    { type: "clause", id: "law", title: "5. Lovvalg", text: "Avtalen følger norsk rett.", optional: false, included: true },
    { type: "signatures" },
  ],
};

const en: Starter = {
  name: "Standard agreement",
  blocks: [
    { type: "heading", text: "{contract.title}" },
    {
      type: "paragraph",
      text: "This agreement is made on {contract.date} between {store.name} (company no. {store.org_number}), the “supplier”, and {customer.name}, the “customer”.",
    },
    { type: "clause", id: "scope", title: "1. What the agreement covers", text: "The supplier delivers {deal.title} to the customer, as described below.", optional: false, included: true },
    { type: "quote_lines" },
    { type: "clause", id: "payment", title: "2. Payment", text: "The customer pays against invoice within 14 days.", optional: false, included: true },
    {
      type: "clause",
      id: "confidentiality",
      title: "3. Confidentiality",
      text: "Each party keeps what it learns about the other under this agreement to itself, also after the agreement ends.",
      optional: true,
      included: true,
    },
    { type: "clause", id: "ending", title: "4. Ending the agreement", text: "Either party may end the agreement in writing with 30 days' notice.", optional: false, included: true },
    { type: "clause", id: "law", title: "5. Governing law", text: "The agreement is governed by the law of the supplier's country.", optional: false, included: true },
    { type: "signatures" },
  ],
};

const STARTERS: Record<string, Starter> = { nb, en };

/** The language a starter is written in for a locale (`nb-NO` → `nb`; Nynorsk and Danish read Norwegian bokmål poorly, so only `nb`/`no`). */
export const starterLanguage = (locale: string): "nb" | "en" => {
  const lang = locale.toLowerCase().split("-")[0];
  return lang === "nb" || lang === "no" ? "nb" : "en";
};

/** The store's first template, in its main language (English where no starter is written in it). */
export function starterTemplate(locale: string): { name: string; language: "nb" | "en"; blocks: ContractBlock[] } {
  const language = starterLanguage(locale);
  const starter = STARTERS[language];
  return { name: starter.name, language, blocks: starter.blocks.map((block) => ({ ...block })) };
}
