"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import type { DuplicateResult } from "@/lib/page-duplicate";
import { PAGE_TYPES, type PageType } from "@/lib/page-content";
import { NO_ACCESS, checkPageTypeAccess } from "@/server/permissions";
import { fieldsTag } from "@/server/custom-fields";
import { duplicatePage } from "@/server/page-duplicate";

/**
 * Duplicates one of a store's pages, articles, layouts, headers or footers as a new draft (D126), bound to the store
 * and the kind of page like the store's other page actions. From the builder `edited` is the JSON the editor holds,
 * so unsaved changes are copied too; from the list it is left out and the saved draft is copied.
 */
export async function duplicateStorePageAction(
  storeSlug: string,
  type: PageType,
  id: string,
  edited?: string,
): Promise<DuplicateResult> {
  const member = await checkPageTypeAccess(storeSlug, type, "write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!PAGE_TYPES.includes(type) || !z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown page."] };
  let held: unknown;
  if (edited !== undefined) {
    try {
      held = JSON.parse(edited);
    } catch {
      return { ok: false, problems: ["The page could not be read. Reload and try again."] };
    }
  }
  const result = await duplicatePage(member.account, member.store.id, id, type, held);
  if (!result.ok) return { ok: false, problems: result.problems };
  // A copy carries the source's custom field values (D118).
  updateTag(fieldsTag(member.store.id));
  return { ok: true, id: result.id };
}
