"use server";

import { z } from "zod";

import type { DuplicateResult } from "@/lib/page-duplicate";
import { PAGE_TYPES, type PageType } from "@/lib/page-content";
import { requirePlatformAdmin } from "@/server/auth";
import { duplicatePage } from "@/server/page-duplicate";

/** Duplicates one of Kaizen's own pages or articles as a new draft (D126); see the store's action. */
export async function duplicatePageAction(type: PageType, id: string, edited?: string): Promise<DuplicateResult> {
  const admin = await requirePlatformAdmin();
  if (!PAGE_TYPES.includes(type) || !z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown page."] };
  let held: unknown;
  if (edited !== undefined) {
    try {
      held = JSON.parse(edited);
    } catch {
      return { ok: false, problems: ["The page could not be read. Reload and try again."] };
    }
  }
  const result = await duplicatePage(admin, null, id, type, held);
  return result.ok ? { ok: true, id: result.id } : { ok: false, problems: result.problems };
}
