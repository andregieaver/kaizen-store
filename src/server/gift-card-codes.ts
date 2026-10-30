import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { giftCodeLast4, makeGiftCode, normaliseGiftCode } from "@/lib/gift-cards";
import { parseKey } from "@/lib/secret-box";

/**
 * Gift card codes on the server (D300): a code is made here, shown once (the email, or staff who issue a card by hand) and kept only as its
 * HMAC, so a database read never gives a code that can be spent. The key is `GIFT_CARD_HASH_KEY`, which never changes with the settings key
 * (PSI SEC-06: the codes are not kept, so a changed key would lose every card); where it is not set, the key made from
 * `SETTINGS_ENCRYPTION_KEY` for this use alone, which `scripts/hash-keys.mjs` prints so it can be set as `GIFT_CARD_HASH_KEY` before a
 * rotation (`docs/runbooks/key-rotation.md`). Without a key there are no gift cards to make or to find.
 */

const giftKey = (): Buffer | null => {
  const own = parseKey(process.env.GIFT_CARD_HASH_KEY);
  if (own) return own;
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
