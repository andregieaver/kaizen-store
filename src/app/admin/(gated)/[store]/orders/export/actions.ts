"use server";

import { checkOrderNumbers } from "@/server/data-jobs";
import { requireOwnerRole } from "@/server/permissions";

/**
 * The order export's one action (D165, `docs/wave-2-data.md` 2.3.1): which of the pasted order numbers are this store's, and which are not (listed back).
 * The owner's, like the file. The export itself is the form's POST to `orders/export/file`; nothing is written here.
 */
export async function checkNumbersAction(
  storeSlug: string,
  pasted: string,
): Promise<{ ok: true; found: string[]; unknown: string[]; over: number } | { ok: false; problem: string }> {
  const member = await requireOwnerRole(storeSlug);
  return checkOrderNumbers(member, typeof pasted === "string" ? pasted.slice(0, 20_000) : "");
}
