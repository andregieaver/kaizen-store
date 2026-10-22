import "server-only";

import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { aiFor } from "@/server/ai";
import { listSegments } from "@/server/segments";
import type { Store } from "@/server/stores";

/** What the broadcast editor offers: the store's languages (main first) by name in the admin's language, its segments, and whether the AI can write. */
export async function broadcastChoices(store: Store, lang: AdminLang = "en") {
  const [segments, ai] = await Promise.all([listSegments(store.id), aiFor(store.id, { feature: "marketing_email" }).catch(() => null)]);
  const tongues = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" });
  return {
    locales: store.localization.locales.map((code) => ({ code, name: tongues.of(code) ?? code })),
    segments: segments.map((s) => ({ id: s.id, name: s.name })),
    aiReady: Boolean(ai?.textModel),
  };
}
