/**
 * The owner's view of a store's gift cards (D300 F4, `docs/wave-5-marketing.md` 8.4), pure: what state a card is in, how its ledger reads in
 * words, and the liability report's sums per currency. A card's balance is never worked out here: it comes from `commerce.gift_card_balance()`
 * with the rows; this only names what the database says.
 */

import { countWords, fillWords } from "./admin-fill";

/** What a card is, read from its row, its balance and the time: spent and expired are never stored. */
export type GiftCardState = "waiting" | "active" | "spent" | "expired" | "deactivated";

export const GIFT_CARD_STATES: readonly GiftCardState[] = ["active", "waiting", "spent", "expired", "deactivated"];

export const STATE_WORDS: Record<GiftCardState, string> = {
  waiting: "Not sent yet",
  active: "Active",
  spent: "Spent",
  expired: "Expired",
  deactivated: "Deactivated",
};

export const STATE_SIGNAL: Record<GiftCardState, "positive" | "warning" | "neutral" | "danger"> = {
  waiting: "warning",
  active: "positive",
  spent: "neutral",
  expired: "neutral",
  deactivated: "danger",
};

export type CardFacts = { status: string; sentAt: string | null; expiresAt: string | null; balanceMinor: number };

/** A card's state now: deactivated first, then waiting for its code to reach anyone, then expired, spent, active. */
export function cardState(card: CardFacts, now: Date = new Date()): GiftCardState {
  if (card.status === "deactivated") return "deactivated";
  if (!card.sentAt) return "waiting";
  if (card.expiresAt && new Date(card.expiresAt).getTime() <= now.getTime()) return "expired";
  if (card.balanceMinor <= 0) return "spent";
  return "active";
}

/** A ledger entry's kind in the words a card's page uses. */
export const ENTRY_WORDS: Record<string, string> = {
  issue: "Issued",
  hold: "Held for an order",
  release: "Given back: the order was not paid",
  spend: "Spent on an order",
  refund: "Refunded back to the card",
  adjust: "Changed by staff",
  expire: "Expired",
  void: "Deactivated",
};

/** The expiry choices the settings offer: 12 to 120 months (the database's range), or none. */
export const EXPIRY_CHOICES: readonly (number | null)[] = [12, 24, 36, 48, 60, 120, null];

/** How long a card lasts in words; `words` are the `giftCards` catalogue's `expiry` (D312 A5), English unless given. */
export type ExpiryWords = { never: string; years: { one: string; many: string }; months: string };

const ENGLISH_EXPIRY: ExpiryWords = { never: "Never", years: { one: "{n} year", many: "{n} years" }, months: "{n} months" };

export const expiryWords = (months: number | null, words: ExpiryWords = ENGLISH_EXPIRY): string =>
  months === null
    ? words.never
    : months % 12 === 0
      ? countWords(months / 12, words.years)
      : fillWords(words.months, { n: months });

/** The longest note staff can give when they change or deactivate a card (the ledger's limit). */
export const GIFT_CARD_NOTE_MAX = 500;

/** One currency's movements in a period and what is held now. Amounts are minor units of that currency, never converted or added across currencies. */
export type LiabilityLine = {
  currency: string;
  /** What customers hold on live cards now: active, delivered, not expired. */
  outstandingMinor: number;
  /** Cards with something on them now. */
  cards: number;
  issuedMinor: number;
  spentMinor: number;
  refundedMinor: number;
  /** Staff changes: up and down together. */
  adjustedMinor: number;
  expiredMinor: number;
  voidedMinor: number;
};

export type LiabilityRow = { currency: string; kind: string; amountMinor: number };

/** The period's ledger sums (`kind` the entry's, an amount as the ledger keeps it: spent and expired are negative) folded into lines per currency, with what is held now. */
export function liabilityLines(movements: readonly LiabilityRow[], outstanding: readonly { currency: string; amountMinor: number; cards: number }[]): LiabilityLine[] {
  const lines = new Map<string, LiabilityLine>();
  const line = (currency: string): LiabilityLine => {
    const key = currency.trim().toUpperCase();
    let found = lines.get(key);
    if (!found) {
      found = { currency: key, outstandingMinor: 0, cards: 0, issuedMinor: 0, spentMinor: 0, refundedMinor: 0, adjustedMinor: 0, expiredMinor: 0, voidedMinor: 0 };
      lines.set(key, found);
    }
    return found;
  };
  for (const o of outstanding) {
    const l = line(o.currency);
    l.outstandingMinor += o.amountMinor;
    l.cards += o.cards;
  }
  for (const m of movements) {
    const l = line(m.currency);
    if (m.kind === "issue") l.issuedMinor += m.amountMinor;
    else if (m.kind === "spend") l.spentMinor += Math.abs(m.amountMinor);
    else if (m.kind === "refund") l.refundedMinor += m.amountMinor;
    else if (m.kind === "adjust") l.adjustedMinor += m.amountMinor;
    else if (m.kind === "expire") l.expiredMinor += Math.abs(m.amountMinor);
    else if (m.kind === "void") l.voidedMinor += Math.abs(m.amountMinor);
  }
  return [...lines.values()].sort((a, b) => b.outstandingMinor - a.outstandingMinor || a.currency.localeCompare(b.currency));
}
