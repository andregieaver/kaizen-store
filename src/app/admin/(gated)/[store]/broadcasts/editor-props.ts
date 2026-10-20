import "server-only";

import { aiFor } from "@/server/ai";
import { listSegments } from "@/server/segments";
import type { Store } from "@/server/stores";

/** What the broadcast editor offers: the store's languages (main first) by name, its segments, and whether the AI can write. */
export async function broadcastChoices(store: Store) {
  const [segments, ai] = await Promise.all([listSegments(store.id), aiFor(store.id, { feature: "marketing_email" }).catch(() => null)]);
  const tongues = new Intl.DisplayNames(["en"], { type: "language" });
  return {
    locales: store.localization.locales.map((code) => ({ code, name: tongues.of(code) ?? code })),
    segments: segments.map((s) => ({ id: s.id, name: s.name })),
    aiReady: Boolean(ai?.textModel),
  };
}
