import { discardDraftAction, draftStateAction, publishDraftAction, startDraftAction } from "@/app/admin/(gated)/[store]/pages/draft-actions";
import { studioAbilities } from "@/server/page-ai";
import { openDraft } from "@/server/store-drafts";

import { StoreDraftPanel } from "./store-drafts";

/**
 * The store drafted from one description (D351), read after the page is shown: the open draft, else *Start from a description* while the
 * store is being set up (`offerStart`) and its AI has a text model.
 */
export async function StoreDraftsSection({ storeId, storeSlug, offerStart }: { storeId: string; storeSlug: string; offerStart: boolean }) {
  const [draft, abilities] = await Promise.all([openDraft(storeId), offerStart ? studioAbilities(storeId) : Promise.resolve({ text: false })]);
  if (!draft && !(offerStart && abilities.text)) return null;
  return (
    <StoreDraftPanel
      storeSlug={storeSlug}
      initial={draft}
      canDraft={offerStart && abilities.text}
      actions={{
        start: startDraftAction.bind(null, storeSlug),
        state: draftStateAction.bind(null, storeSlug),
        publish: publishDraftAction.bind(null, storeSlug),
        discard: discardDraftAction.bind(null, storeSlug),
      }}
    />
  );
}
