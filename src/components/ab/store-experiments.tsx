import { runningExperimentIds } from "@/server/experiments";

import { AbAssign } from "./ab-assign";

/**
 * Gives visitors their versions of a store's running A/B tests (D148), where there are any: nothing at all on a store
 * with none, so its pages stay as they were. The script itself waits for the visitor's consent.
 */
export async function StoreExperiments({ storeId, store, market }: { storeId: string; store: string; market: string }) {
  const running = await runningExperimentIds(storeId);
  return running.length > 0 ? <AbAssign storeId={storeId} store={store} market={market} running={running} /> : null;
}
