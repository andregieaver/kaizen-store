import "server-only";

import type { Db } from "@/db/client";

/**
 * The glue between Work's tasks and time (`work.ts`, `work-time.ts`) and its
 * draft invoices (`work-invoices.ts`, docs/work.md 4.6, 7.2 WP3/WP4). The
 * invoice module imports `workEvent` from `work.ts`, so `work.ts` and
 * `work-time.ts` reach the invoice hooks only through this leaf module, which
 * loads `work-invoices.ts` when a hook runs (never at import): there is no
 * import cycle.
 *
 * Each hook takes the transaction of the write it follows, so a task and its
 * draft line (and a time entry and its line's hours) change together or not at
 * all. What each does is documented on the hook in `work-invoices.ts`.
 */

const invoices = () => import("./work-invoices");

/** After a task was added or renamed: its line on the assignment's draft (made if missing, else renamed). */
export async function syncTaskToDraftLine(
  run: Db,
  args: { storeId: string; assignmentId: string; task: { id: string; title: string; estimatedMinutes: number | null } },
): Promise<string | null> {
  return (await invoices()).syncTaskToDraftLine(run, args);
}

/** Before a task is deleted: takes its line off the drafts it is on (issued invoices keep theirs). */
export async function removeLinesForTask(run: Db, args: { storeId: string; taskId: string }): Promise<string[]> {
  return (await invoices()).removeLinesForTask(run, args);
}

/** After billable time was logged on a task: the task's unbilled time goes onto its draft line and the hours follow. */
export async function syncTaskHoursToDraftLine(
  run: Db,
  args: { storeId: string; taskId: string },
): Promise<string | null> {
  return (await invoices()).syncTaskHoursToDraftLine(run, args);
}

/** After a client's or the store's VAT details changed: re-prices the drafts (one client's, or all the store's). */
export async function refreshDraftInvoices(run: Db, args: { storeId: string; clientId?: string }): Promise<number> {
  return (await invoices()).refreshDraftInvoices(run, args);
}
