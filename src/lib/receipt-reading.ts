import { z } from "zod";

import { UNTRUSTED_TEXT, withoutInstructions } from "./prompt-safety";
import { isPurchaseKind, PURCHASE_KINDS, type PurchaseKind, type PurchaseVatRate } from "./purchases";

/**
 * A receipt read by the model that sees pictures (D163) into the choice the owner makes when posting a purchase (B3 step 2, D491). Pure: the
 * prompt, and reading the answer. The model only suggests: what was bought (one of the purchase kinds), the VAT rate, the supplier's name
 * and the total. The owner sees each in the form and posts; what is posted is the bank's amount, its VAT worked out in code
 * (`entryOfPurchase()`), never a number the model read: the total read is only compared with the bank's, to warn of a wrong receipt.
 * Grounded as the other AI uses: the picture is data (`UNTRUSTED_TEXT`), the answer a JSON object read by its shape, a name cleaned of
 * text addressed to an AI, and anything outside the choices dropped.
 */

export { READABLE_RECEIPTS } from "./purchases";

export const KIND_WORDS: Record<PurchaseKind, string> = {
  goods: "goods bought to sell on",
  office: "office supplies",
  software: "software, apps and subscriptions",
  equipment: "computers, screens and other computer equipment",
  phone: "phone and internet",
  advertising: "advertising",
  courses: "courses, meetings and conferences",
  accounting: "accounting and auditing",
  travel: "travel: tickets, taxis, hotels",
  meals: "meals and drinks with clients",
  rent: "rent of premises",
  postage: "postage and stamps",
  insurance: "insurance",
};

/** The model's instructions and question for a receipt, the books' currency named. */
export function receiptPrompt(bookCurrency: string): { system: string; user: string } {
  const kinds = (Object.keys(PURCHASE_KINDS) as PurchaseKind[]).map((k) => `"${k}" (${KIND_WORDS[k]})`).join(", ");
  return {
    system: [
      "You read a photo of a receipt or an invoice a small business has paid, so its owner can post it in the books.",
      UNTRUSTED_TEXT,
      "Read only what the picture shows. Never guess a number or a name you cannot read: write null for it.",
      'Answer with one JSON object and nothing else: {"supplier": string or null, "date": "YYYY-MM-DD" or null, "currency": three letters or null, "total": number or null, "vat": [{"rate": number, "amount": number}], "kind": string}.',
      "total is what was paid, VAT included, and each vat amount is in the receipt's currency, as a decimal number (199.50). vat lists each VAT rate in percent the receipt shows with its VAT amount, and is empty when it shows no VAT.",
      `kind is what was bought, the closest of: ${kinds}.`,
    ].join("\n"),
    user: `What does this receipt say? The business keeps its books in ${bookCurrency}.`,
  };
}

const ANSWER = z.object({
  supplier: z.string().nullish(),
  date: z.string().nullish(),
  currency: z.string().nullish(),
  total: z.number().nullish(),
  vat: z.array(z.object({ rate: z.number(), amount: z.number() })).nullish(),
  kind: z.string().nullish(),
});

export type ReceiptReading = {
  supplier: string | null;
  day: string | null;
  currency: string | null;
  totalMinor: number | null;
  kind: PurchaseKind | null;
  /** The rate most of the receipt's VAT is at; none when it shows no VAT; null when it shows a rate the books do not post. */
  vatRate: PurchaseVatRate | null;
};

/** A supplier's name as the model read it: one plain line, no text addressed to an AI, at most 80 characters; null when nothing is left. */
export function cleanName(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = withoutInstructions(value);
  if (cleaned !== value) return null;
  const line = value
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return line || null;
}

/** The model's answer read into the choices, or null when it is no answer of the asked shape. */
export function parseReceiptReading(reply: string): ReceiptReading | null {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0];
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = ANSWER.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const day = a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && !Number.isNaN(Date.parse(`${a.date}T00:00:00Z`)) ? a.date : null;
  const currency = a.currency && /^[A-Z]{3}$/.test(a.currency.trim().toUpperCase()) ? a.currency.trim().toUpperCase() : null;
  const totalMinor = typeof a.total === "number" && Number.isFinite(a.total) && a.total > 0 && a.total < 1e9 ? Math.round(a.total * 100) : null;
  const vat = (a.vat ?? []).filter((v) => Number.isFinite(v.rate) && Number.isFinite(v.amount) && v.amount > 0);
  let vatRate: PurchaseVatRate | null;
  if (vat.length === 0) vatRate = a.vat ? 0 : null;
  else {
    const top = vat.reduce((best, v) => (v.amount > best.amount ? v : best));
    vatRate = top.rate === 25 || top.rate === 15 || top.rate === 12 ? top.rate : null;
  }
  return { supplier: cleanName(a.supplier), day, currency, totalMinor, kind: isPurchaseKind(a.kind) ? a.kind : null, vatRate };
}

/** Whether the receipt's total is the bank's amount: the same, another, or not known (not read, or in another currency). */
export function receiptAgrees(reading: ReceiptReading, bankMinor: number, bookCurrency: string): "same" | "differs" | "unknown" {
  if (reading.totalMinor === null || (reading.currency !== null && reading.currency !== bookCurrency)) return "unknown";
  return reading.totalMinor === Math.abs(bankMinor) ? "same" : "differs";
}
