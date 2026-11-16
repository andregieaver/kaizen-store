import type { DocumentLanguage } from "./invoice-text";

/**
 * A purchase order emailed to its supplier (`docs/100-day-challenge.md` C3), in the supplier's order language as drop-ship orders are (D550):
 * the goods, units and unit costs, the total, the reference and the date wanted. No person's details: a supplier is a business. Pure words.
 */
export type PurchaseOrderWords = {
  subject: string;
  preview: string;
  heading: string;
  intro: string;
  lines: string;
  each: string;
  total: string;
  reference: string;
  wanted: string;
  footer: string;
};

const WORDS: Record<DocumentLanguage, PurchaseOrderWords> = {
  en: {
    subject: "Purchase order {reference} from {store}",
    preview: "What {store} orders from you, and when.",
    heading: "Purchase order from {store}",
    intro: "{store} orders the goods below. Please deliver them as you usually do for {store}, and send the invoice the usual way.",
    lines: "What {store} orders",
    each: "× {quantity} at {cost} each",
    total: "Total, without VAT: {total}",
    reference: "Our reference: {reference}",
    wanted: "Wanted by {date}",
    footer: "Sent by Kaizena Flow for {store}. Questions about this order go to {store}.",
  },
  nb: {
    subject: "Innkjøpsordre {reference} fra {store}",
    preview: "Hva {store} bestiller fra deg, og når.",
    heading: "Innkjøpsordre fra {store}",
    intro: "{store} bestiller varene nedenfor. Lever dem slik du pleier for {store}, og send fakturaen på vanlig måte.",
    lines: "Hva {store} bestiller",
    each: "× {quantity} à {cost}",
    total: "Totalt, uten mva.: {total}",
    reference: "Vår referanse: {reference}",
    wanted: "Ønskes innen {date}",
    footer: "Sendt av Kaizena Flow for {store}. Spørsmål om ordren går til {store}.",
  },
  sv: {
    subject: "Inköpsorder {reference} från {store}",
    preview: "Vad {store} beställer från dig, och när.",
    heading: "Inköpsorder från {store}",
    intro: "{store} beställer varorna nedan. Leverera dem som du brukar till {store} och skicka fakturan på vanligt sätt.",
    lines: "Vad {store} beställer",
    each: "× {quantity} à {cost}",
    total: "Totalt, exkl. moms: {total}",
    reference: "Vår referens: {reference}",
    wanted: "Önskas senast {date}",
    footer: "Skickat av Kaizena Flow för {store}. Frågor om ordern går till {store}.",
  },
  da: {
    subject: "Indkøbsordre {reference} fra {store}",
    preview: "Hvad {store} bestiller hos dig, og hvornår.",
    heading: "Indkøbsordre fra {store}",
    intro: "{store} bestiller varerne nedenfor. Lever dem, som du plejer til {store}, og send fakturaen på den sædvanlige måde.",
    lines: "Hvad {store} bestiller",
    each: "× {quantity} à {cost}",
    total: "I alt, ekskl. moms: {total}",
    reference: "Vores reference: {reference}",
    wanted: "Ønskes senest {date}",
    footer: "Sendt af Kaizena Flow for {store}. Spørgsmål om ordren går til {store}.",
  },
};

/** A purchase order's words in the supplier's order language (English for any other). */
export const purchaseOrderWords = (lang: string): PurchaseOrderWords => WORDS[(lang in WORDS ? lang : "en") as DocumentLanguage];
