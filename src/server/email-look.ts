import "server-only";

import { emailLook, type EmailLook } from "@/lib/email-look";
import { parseStoreTheme } from "@/lib/theme-schema";

import { getPlatformTheme } from "./platform-navigation";
import { liveLook } from "./theme-installs";

/**
 * The look of a store's marketing emails (email plan M4.1): its live theme's accent and button corners (`emailLook()`); Kaizena Flow's
 * own theme for the platform. Kept five minutes per store in this server instance, so a batch of a thousand emails reads it once and a
 * changed theme shows in the next sends.
 */
const KEEP_MS = 5 * 60_000;
const kept = new Map<string, { at: number; look: Promise<EmailLook> }>();

export function emailLookOf(storeId: string | null): Promise<EmailLook> {
  const key = storeId ?? "platform";
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.look;
  const look = (async () => {
    const theme = storeId ? parseStoreTheme((await liveLook(storeId))?.theme ?? {}) : await getPlatformTheme();
    return emailLook(theme.settings);
  })().catch(() => emailLook(null));
  kept.set(key, { at: Date.now(), look });
  return look;
}
