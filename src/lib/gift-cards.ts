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
