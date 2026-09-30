"use server";

import type { MotionPlanResult } from "@/lib/motion-plan";
import type { PageType } from "@/lib/page-content";
import { aiFor } from "@/server/ai";
import { requirePlatformAdmin } from "@/server/auth";
import { planPageMotion, readMotionRows } from "@/server/motion-ai";

/** "Make my page cool" (D128) for one of Kaizen's own pages or articles; see the store's action. */
export async function planMotionAction(type: PageType, rowsJson: string): Promise<MotionPlanResult> {
  const admin = await requirePlatformAdmin();
  const read = readMotionRows(type, rowsJson);
  if (!read.ok) return read;
  const connection = await aiFor(null, { feature: "page_motion", accountId: admin.id });
  return planPageMotion(connection, read.rows);
}
