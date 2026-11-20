import { pageGoalTests } from "@/server/experiments-read";

import { AbPageGoal } from "../lazy/blocks";

/**
 * Says a visitor opened this page, for the running A/B tests whose goal is going on to it (D148 phase 20): nothing at all on a page no test
 * counts, so it stays as it was. `pageId` is the page as published, never a version of it.
 */
export async function PageGoal({ storeId, store, pageId }: { storeId: string; store: string; pageId: string | null | undefined }) {
  if (!pageId) return null;
  const experiments = await pageGoalTests(storeId, pageId);
  return experiments.length > 0 ? <AbPageGoal storeId={storeId} store={store} pageId={pageId} experiments={experiments} /> : null;
}
