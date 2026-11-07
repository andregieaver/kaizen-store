import type { LedgerEntryInput } from "./ledger";

/**
 * The bank's own lines on its statement: its fees and its interest (B4 of `docs/own-books-and-sales.md`, D488). For these the statement is
 * the voucher (the bank charged or paid it, and says so), and neither carries VAT (financial services are outside it), so the owner can post
 * one with a press: a fee to bank charges (7770), interest paid to the business to interest from bank deposits (8050), interest it paid to
 * interest on bank loans (8150), each against the bank's account (1920). Pure: which a line is, by its words, and the entry it makes. A card
 * purchase or any other cost is not the bank's own: it needs its receipt (B3).
 */

export type BankOwnKind = "fee" | "interest_in" | "interest_out";

export const BANK_OWN_ACCOUNTS: Record<BankOwnKind, number> = { fee: 7770, interest_in: 8050, interest_out: 8150 };

/** The bank's account the statement is matched to (as `BANK_ACCOUNT` of the server's statements). */
const BANK = 1920;

const FEE_WORDS = new Set(["omkostning", "omkostninger", "pakkepris", "månedspris", "fee", "fees", "charge", "charges", "avgift"]);
const INTEREST_WORDS = new Set(["interest", "renteinntekt", "renteinntekter", "rentekostnad", "rentekostnader"]);

/** A line's words, lower case, split on what is not a letter (Nordic letters kept). */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zæøåäö]+/)
    .filter(Boolean);
}

/**
 * Whether a line is one of the bank's own, by its words: a fee (`gebyr` and its compounds such as *kontoholdsgebyr*, *omkostninger*, a
 * package's monthly price, *fee*, *charges*) or interest (`rente`, `renter` and their compounds such as *kreditrenter*, *interest*), interest
 * in or out by the sign. A fee given back (money in) is still a fee. Null for anything else, and for a line that reads as both.
 */
export function bankOwnKind(line: { amountMinor: number; text: string }): BankOwnKind | null {
  if (line.amountMinor === 0) return null;
  const words = wordsOf(line.text);
  const fee = words.some((w) => w.endsWith("gebyr") || w.endsWith("gebyrer") || FEE_WORDS.has(w));
  const interest = words.some((w) => w.endsWith("rente") || w.endsWith("renter") || INTEREST_WORDS.has(w));
  if (fee === interest) return null;
  if (fee) return "fee";
  return line.amountMinor > 0 ? "interest_in" : "interest_out";
}

/** The entry a bank's own line makes: its account against the bank's, in the bank's series on the bank's day, no VAT. */
export function entryOfBankOwnLine(line: { id: string; day: string; amountMinor: number; text: string }, kind: BankOwnKind): LedgerEntryInput {
  const text = line.text.trim().slice(0, 200) || (kind === "fee" ? "Bankgebyr" : "Renter");
  return {
    series: "B",
    date: line.day,
    text,
    source: { kind: "bank_line", id: line.id },
    lines: [
      { account: BANK, amountMinor: line.amountMinor, vatCode: null },
      { account: BANK_OWN_ACCOUNTS[kind], amountMinor: -line.amountMinor, vatCode: null },
    ],
  };
}
