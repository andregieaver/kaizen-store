import { momentText } from "@/lib/data-admin";
import { batchSummary, listBatches, type UndoResult } from "@/server/bulk-edit";

import { RecentBatches } from "./bulk-result";

/**
 * The store's recent bulk changes with their results and, inside the seven days, an Undo (D165, 2.6). Read for the store the page is for, newest first;
 * `batchSummary()` counts a batch from its items, so the figures are what was recorded.
 */
export async function BulkRecent({ storeId, timeZone, undo }: { storeId: string; timeZone: string; undo: (batchId: string) => Promise<UndoResult> }) {
  const batches = await listBatches(storeId, 10);
  const summaries = (await Promise.all(batches.map((b) => batchSummary(storeId, b.id)))).flatMap((s, i) => (s ? [{ summary: s, when: momentText(batches[i].createdAt, timeZone) }] : []));
  return (
    <section aria-labelledby="recent-bulk" className="flex flex-col gap-2">
      <h2 id="recent-bulk" className="text-base font-semibold">
        Recent bulk changes
      </h2>
      <RecentBatches batches={summaries} undo={undo} />
    </section>
  );
}
