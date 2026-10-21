import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { giftCodeLast4, makeGiftCode, normaliseGiftCode } from "@/lib/gift-cards";
import { parseKey } from "@/lib/secret-box";

/**
 * Gift card codes on the server (D300): a code is made here, shown once (the email, or staff who issue a card by hand) and kept only as its
 * HMAC, with a key made from `SETTINGS_ENCRYPTION_KEY` for this use alone, so a database read never gives a code that can be spent. Without
 * the key there are no gift cards to make or to find.
 */

const giftKey = (): Buffer | null => {
  const secret = parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
  return secret ? createHmac("sha256", secret).update("kaizen:gift-card-code").digest() : null;
};

/** Whether this server can make and find gift card codes. */
export const giftCodesAvailable = (): boolean => giftKey() !== null;

/** The hash a code is kept and found by: of the code as a person would type it, normalised. Null without the key. */
export function hashGiftCode(typed: string): string | null {
  const key = giftKey();
  return key ? createHmac("sha256", key).update(normaliseGiftCode(typed)).digest("hex") : null;
}

/** A new code, with what is kept of it. */
export function newGiftCode(): { code: string; hash: string; last4: string } | null {
  const code = makeGiftCode((n) => randomBytes(n));
  const hash = hashGiftCode(code);
  return hash ? { code, hash, last4: giftCodeLast4(code) } : null;
}
