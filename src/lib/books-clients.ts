import { vatTermsOf, type VatTerm, type VatTermSize } from "./vat-return";

/**
 * An accountant's clients (B6, D512): each store whose books the person may read, and what its books need from them now. Pure: the VAT term
 * to report (the last that has ended and is not locked through), the bank's lines and the documents that wait, the supplier invoices due,
 * the receipts in the books' inbox, and the books not locked through that term. The most pressing first.
 */

export type ClientBook = { openedOn: string; lockedThrough: string | null; lockHeld: boolean; vatTerm: VatTermSize; currency: string };

export type ClientFacts = {
  slug: string;
  name: string;
  /** The person owns the store (else they keep or read its books as a member, an accountant). */
  owner: boolean;
  /** The person may change the books (`books:write`). */
  keeps: boolean;
  book: ClientBook | null;
  /** The bank's lines after the books opened with no entry yet. */
  bankWaiting: number;
  /** Documents the books could not post yet (a locked day, a missing rate). */
  ledgerWaiting: number;
  /** Supplier invoices not paid, and of them those due on or before today. */
  billsUnpaid: number;
  billsDue: number;
  /** Receipts and invoices emailed to the books, not used yet. */
  inboxWaiting: number;
  /** The VAT of the term to report, from the books (positive: to pay). */
  vatTotalMinor: number | null;
};

export type ClientNeed =
  | { kind: "open_books" }
  | { kind: "vat"; term: VatTerm; late: boolean }
  | { kind: "bank"; count: number }
  | { kind: "waiting"; count: number }
  | { kind: "bills"; count: number }
  | { kind: "inbox"; count: number };

/** The VAT term to report now: the last that has ended, while the books are not locked through it (locking is how a reported term is kept). */
export function vatToReport(book: ClientBook, today: string): VatTerm | null {
  const ended = vatTermsOf(book.vatTerm, book.openedOn, today).find((t) => t.to < today) ?? null;
  if (!ended) return null;
  if (book.lockedThrough !== null && book.lockedThrough >= ended.to) return null;
  return ended;
}

/** What a client's books need, the most pressing first: a late or due VAT term, bills due, the bank and documents waiting, the inbox. */
export function clientNeeds(facts: ClientFacts, today: string): ClientNeed[] {
  if (!facts.book) return [{ kind: "open_books" }];
  const needs: ClientNeed[] = [];
  const term = vatToReport(facts.book, today);
  if (term) needs.push({ kind: "vat", term, late: today > term.due });
  if (facts.billsDue > 0) needs.push({ kind: "bills", count: facts.billsDue });
  if (facts.bankWaiting > 0) needs.push({ kind: "bank", count: facts.bankWaiting });
  if (facts.ledgerWaiting > 0) needs.push({ kind: "waiting", count: facts.ledgerWaiting });
  if (facts.inboxWaiting > 0) needs.push({ kind: "inbox", count: facts.inboxWaiting });
  return needs;
}

/** How pressing a client is: a late VAT term first, then one due within two weeks, then by how much waits; books not open last. */
export function clientUrgency(facts: ClientFacts, today: string): number {
  const needs = clientNeeds(facts, today);
  let score = 0;
  for (const need of needs) {
    if (need.kind === "vat") score += need.late ? 10_000 : daysBetween(today, need.term.due) <= 14 ? 5_000 : 1_000;
    else if (need.kind === "bills") score += 500 + need.count;
    else if (need.kind === "open_books") score -= 1;
    else score += need.count;
  }
  return score;
}

/** The clients in the order an accountant works them: the most pressing first, then by name. */
export function sortClients<T extends ClientFacts>(clients: readonly T[], today: string): T[] {
  return [...clients].sort((a, b) => clientUrgency(b, today) - clientUrgency(a, today) || a.name.localeCompare(b.name, "nb") || a.slug.localeCompare(b.slug));
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Whether the person is shown the clients' screen: they keep or read books as a member of a store they do not own, or of two or more. */
export const showsClients = (stores: readonly { owner: boolean }[]): boolean => stores.length >= 2 || stores.some((s) => !s.owner);
