// The keys gift card and recovery codes are hashed under when they have none of their own: each made from `SETTINGS_ENCRYPTION_KEY` for
// that use alone, as `src/server/gift-card-codes.ts` and `src/server/recovery-codes.ts` make them (`hash-keys.test.ts` holds the two
// together). Pure: no environment, no output.
import { createHmac } from "node:crypto";

/** The two derived keys, base64, from the settings key (base64, 32 bytes); null when it is not one. */
export function derivedHashKeys(settingsKey) {
  const key = settingsKey ? Buffer.from(settingsKey, "base64") : null;
  if (!key || key.length !== 32) return null;
  const derive = (label) => createHmac("sha256", key).update(label).digest().toString("base64");
  return { GIFT_CARD_HASH_KEY: derive("kaizen:gift-card-code"), RECOVERY_CODE_HASH_KEY: derive("kaizen.recovery-codes.v1") };
}
