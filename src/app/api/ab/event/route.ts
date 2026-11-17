import { connection } from "next/server";

import { abRequest, quiet } from "@/server/ab-request";
import { readAssignments, recordClick, recordPageGoal, takeExperimentRequest } from "@/server/experiments";

/**
 * Records a click on the block a test counts (D148), or the page its goal names opened (`page`, phase 20), from a visitor who was shown the
 * test: once, and only the test's own block or page.
 */
export async function POST(request: Request) {
  await connection();
  const ctx = await abRequest(request);
  if (ctx instanceof Response) return ctx;
  const { storeId, body } = ctx;
  const mine = await readAssignments(storeId);
  if (!mine) return quiet();
  if (!(await takeExperimentRequest(storeId, mine.visitor))) return new Response(null, { status: 429 });
  const experiment = typeof body.experiment === "string" ? body.experiment : "";
  if (typeof body.page === "string") {
    await recordPageGoal(storeId, experiment, body.page);
    return quiet();
  }
  const block = typeof body.block === "string" ? body.block : "";
  await recordClick(storeId, experiment, block);
  return quiet();
}
