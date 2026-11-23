import "server-only";

import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { aiFor } from "@/server/ai";
import { listSavedBlocks } from "@/server/email-saved-blocks";
import { uploadsEnabled } from "@/server/media";
import { listSegments } from "@/server/segments";
import type { Store } from "@/server/stores";

import {
  audienceCountAction,
  deleteSavedBlockAction,
  findBroadcastFactsAction,
  saveBlockAction,
  saveBroadcastAction,
  suggestBroadcastAction,
  suggestTestSubjectsAction,
  uploadBroadcastPictureAction,
} from "./actions";

/** The editor's actions, the same on a new broadcast's page and a draft's. */
export const editorActions = () => ({
  save: saveBroadcastAction,
  count: audienceCountAction,
  suggest: suggestBroadcastAction,
  facts: findBroadcastFactsAction,
  subjects: suggestTestSubjectsAction,
  upload: uploadsEnabled() ? uploadBroadcastPictureAction : null,
  saveBlock: saveBlockAction,
  deleteBlock: deleteSavedBlockAction,
});

/** What the broadcast editor offers: the store's languages (main first) by name in the admin's language, its segments, whether the AI can write, and its saved blocks (M4.1). */
export async function broadcastChoices(store: Store, lang: AdminLang = "en") {
  const [segments, ai, savedBlocks] = await Promise.all([
    listSegments(store.id),
    aiFor(store.id, { feature: "marketing_email" }).catch(() => null),
    listSavedBlocks(store.id),
  ]);
  const tongues = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" });
  return {
    locales: store.localization.locales.map((code) => ({ code, name: tongues.of(code) ?? code })),
    segments: segments.map((s) => ({ id: s.id, name: s.name })),
    aiReady: Boolean(ai?.textModel),
    savedBlocks,
  };
}
