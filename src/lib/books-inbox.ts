import { chargeOf, chargeWords, plainWords, type RecurringCost, type RecurringLine } from "./recurring-costs";

/**
 * The books' inbox (D504, subscriptions step 3): receipts and invoices sent or forwarded to a store's books address, each attachment kept
 * as a document waiting for its bank line. Pure: which waiting bank line a document most likely documents, by who sent it and what it says
 * against the line's words or its subscription's (D503), and how near their days are.
 */

/** The days either side of a bank line a receipt is looked for in (cards are often charged a few days after the receipt is sent). */
export const INBOX_DAYS = 10;

/** A received attachment the inbox keeps: a PDF or a picture, no larger than a voucher (`VOUCHER_BYTES`). */
export const INBOX_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;

export type InboxDocument = { id: string; receivedOn: string; from: string; subject: string | null; fileName: string };

/** The words a document is known by: its sender's address and name, its subject and its file's name. */
export function documentWords(doc: Pick<InboxDocument, "from" | "subject" | "fileName">): string {
  return ` ${plainWords([doc.from, doc.subject ?? "", doc.fileName].join(" "))} `;
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/**
 * Whether a document is a bank line's: within `INBOX_DAYS` of it, and carrying the words of the line's subscription (its `match_text`), or
 * else the first word the line's charge is known by (`chargeWords()`), as a whole word.
 */
export function documentFits(doc: InboxDocument, line: RecurringLine, costs: readonly RecurringCost[]): boolean {
  if (line.amountMinor >= 0 || Math.abs(dayNumber(doc.receivedOn) - dayNumber(line.day)) > INBOX_DAYS) return false;
  const words = documentWords(doc);
  const cost = chargeOf(line, costs);
  if (cost) return words.includes(` ${plainWords(cost.matchText)} `);
  const first = chargeWords(line).split(" ")[0] ?? "";
  return first.length >= 4 && words.includes(` ${first} `);
}

/**
 * The document each waiting line most likely is, each document given to one line at most: the pairs that fit, the nearest days first (a
 * line's subscription before its bare words where days tie).
 */
export function inboxMatches(docs: readonly InboxDocument[], lines: readonly RecurringLine[], costs: readonly RecurringCost[]): Map<string, string> {
  const pairs: { lineId: string; docId: string; distance: number }[] = [];
  for (const line of lines) {
    for (const doc of docs) {
      if (documentFits(doc, line, costs)) pairs.push({ lineId: line.id, docId: doc.id, distance: Math.abs(dayNumber(doc.receivedOn) - dayNumber(line.day)) });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || a.lineId.localeCompare(b.lineId) || a.docId.localeCompare(b.docId));
  const byLine = new Map<string, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (byLine.has(p.lineId) || used.has(p.docId)) continue;
    byLine.set(p.lineId, p.docId);
    used.add(p.docId);
  }
  return byLine;
}
