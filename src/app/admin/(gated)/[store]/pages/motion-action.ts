"use server";

import type { MotionPlanResult } from "@/lib/motion-plan";
import type { PageType } from "@/lib/page-content";
import { aiFor } from "@/server/ai";
import { NO_ACCESS, checkPageTypeAccess } from "@/server/permissions";
import { planPageMotion, readMotionRows } from "@/server/motion-ai";

/**
 * "Make my page cool" (D128) for one of a store's pages: from the page as it is in the editor, even unsaved. Only a
 * plan comes back (`planPageMotion`, with the store's AI or, without one, the rules); the editor applies it to the
 * page in the browser, the owner sees it and saves. Nothing is written here. Bound to the store and the kind of page
 * like the store's other page actions.
 */
export async function planMotionAction(storeSlug: string, type: PageType, rowsJson: string): Promise<MotionPlanResult> {
  const member = await checkPageTypeAccess(storeSlug, type, "write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const read = readMotionRows(type, rowsJson);
  if (!read.ok) return read;
  const connection = await aiFor(member.store.id, { feature: "page_motion", accountId: member.account.id });
  return planPageMotion(connection, read.rows);
}
