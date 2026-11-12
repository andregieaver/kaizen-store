import "server-only";

import { parseKey } from "@/lib/secret-box";

/** The key that encrypts payment secrets, or null if the server lacks one. */
export function encryptionKey(): Buffer | null {
  return parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
}
