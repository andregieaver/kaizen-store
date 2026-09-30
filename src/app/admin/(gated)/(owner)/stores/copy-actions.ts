"use server";

import type { CopyChoices, StoreCopyProgress, StoreCopyResult } from "@/lib/store-copy";
import { requireAccount } from "@/server/auth";
import { copyChoices, copyProgress, startStoreCopy } from "@/server/store-copy";

/**
 * Duplicating a store (D129): the wizard's server side. Plain server actions for the client components, each for the
 * signed-in account only (`requireAccount()`, as `createStoreAction` does); the server checks that the account owns
 * the store it copies and that a progress page is the account's own. Results are plain data.
 */

/** What can be chosen from a store the account owns: pages, products, posts, and how many customers and orders. */
export async function copyChoicesAction(sourceSlug: string): Promise<StoreCopyResult<{ choices: CopyChoices }>> {
  const account = await requireAccount();
  return copyChoices(account, String(sourceSlug));
}

/** Makes the new store from the wizard's input; the new store's pages and products are there when this returns. */
export async function startStoreCopyAction(input: unknown): Promise<StoreCopyResult<{ id: string }>> {
  const account = await requireAccount();
  return startStoreCopy(account, input);
}

/** A copy's progress; the same answer for a malformed id, an unknown one and one that is someone else's. */
export async function copyProgressAction(id: string): Promise<StoreCopyResult<{ progress: StoreCopyProgress }>> {
  const account = await requireAccount();
  return copyProgress(account, id);
}
