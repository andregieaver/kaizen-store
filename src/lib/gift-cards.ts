/**
 * Gift cards (wave 5 unit F, D300, `docs/wave-5-marketing.md` 8): their codes, pure and free of zod, since the checkout's gift card field is on
 * a pay route. A code is 16 characters from the same alphabet as generated discount codes (no 0, O, 1, I or L), shown in groups of four; what
 * a person types is read loosely (case, spaces, dashes) and compared by its hash on the server, never stored.
 */

/** The same characters as generated discount codes (D299, `GENERATED_ALPHABET`; a test holds them equal). */
export const GIFT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const GIFT_CODE_LENGTH = 16;

/** At most this many cards on one cart. */
export const GIFT_CARDS_PER_CART = 3;

/** A new code from `random` (crypto's on the server): every character equally likely. */
export function makeGiftCode(random: (n: number) => Uint8Array): string {
  const limit = 256 - (256 % GIFT_CODE_ALPHABET.length);
  let out = "";
  let bytes = random(GIFT_CODE_LENGTH * 2);
  let i = 0;
  while (out.length < GIFT_CODE_LENGTH) {
    if (i >= bytes.length) {
      bytes = random(GIFT_CODE_LENGTH);
      i = 0;
    }
    const byte = bytes[i++];
    if (byte < limit) out += GIFT_CODE_ALPHABET[byte % GIFT_CODE_ALPHABET.length];
  }
  return out;
}

/** What a person typed, as the code it would be: capitals, without spaces, dashes and dots. */
export const normaliseGiftCode = (typed: string): string => typed.toUpperCase().replace(/[\s\-–—_.]/g, "");

/** Whether a typed code could be one at all: the right length and characters, once normalised. Asked before the server is. */
export function looksLikeGiftCode(typed: string): boolean {
  const code = normaliseGiftCode(typed);
  return code.length === GIFT_CODE_LENGTH && [...code].every((c) => GIFT_CODE_ALPHABET.includes(c));
}

/** A code in groups of four, as the email and staff see it once. */
export const formatGiftCode = (code: string): string => (code.match(/.{1,4}/g) ?? []).join("-");

/** The last four characters people see in lists and on the receipt. */
export const giftCodeLast4 = (code: string): string => code.slice(-4);

/** A card on a cart, as the cart read it: what it holds now, and whether it can pay for this basket at all (`usable`). */
export type CardForBasket = { id: string; balanceMinor: number; usable: boolean };

/** What one card pays, and what it holds after. */
export type CardPart = { id: string; amountMinor: number; afterMinor: number };

/** What the cards pay together, and what is left for the shopper to pay another way. */
export type CardsPayment = { parts: CardPart[]; paidMinor: number; restMinor: number };

/**
 * What the cards on a basket pay (D300 F3, `docs/wave-5-marketing.md` 8.3): a payment, never a discount. The cards pay first, in the order they
 * were added, each never more than it holds nor more than is left of `payableMinor` (what is due online now, without what a gift card line
 * costs, since a gift card never pays for a gift card). A card that cannot pay for the basket pays nothing and keeps its balance; so does one
 * the others have already covered. A rest under `minRestMinor` (the provider's smallest charge) is raised to it, the cards paying less, since
 * it could not be charged. `cartSummary()` and `placeOrder()` both use this, so they agree.
 */
export function giftCardsPay(cards: readonly CardForBasket[], payableMinor: number, minRestMinor = 0): CardsPayment {
  let rest = Math.max(0, Math.trunc(payableMinor));
  const parts: CardPart[] = [];
  for (const card of cards) {
    const balance = Math.max(0, Math.trunc(card.balanceMinor));
    const amount = card.usable ? Math.min(balance, rest) : 0;
    rest -= amount;
    parts.push({ id: card.id, amountMinor: amount, afterMinor: balance - amount });
  }
  // A rest smaller than the provider's smallest charge cannot be paid: the cards leave that much instead, the last card giving back first.
  let back = rest > 0 && rest < minRestMinor ? Math.min(minRestMinor, Math.max(0, Math.trunc(payableMinor))) - rest : 0;
  for (let i = parts.length - 1; i >= 0 && back > 0; i--) {
    const give = Math.min(parts[i].amountMinor, back);
    parts[i] = { ...parts[i], amountMinor: parts[i].amountMinor - give, afterMinor: parts[i].afterMinor + give };
    rest += give;
    back -= give;
  }
  const paidMinor = parts.reduce((sum, p) => sum + p.amountMinor, 0);
  return { parts, paidMinor, restMinor: rest };
}
