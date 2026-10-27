import { parseKey } from "@/lib/secret-box";

/**
 * The server's own secret, from which the private-mode pass's key is made (D339, `src/lib/unlock-pass.ts`); null leaves every pass off, so a
 * private store lets no one in. A module of its own, so the proxy reads it without the private-mode writers' imports.
 */
export const unlockSecret = (): Buffer | null => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
