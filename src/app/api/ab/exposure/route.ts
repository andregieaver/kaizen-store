import { connection } from "next/server";

import { abRequest, quiet } from "@/server/ab-request";
import { readAssignments, recordExposure, takeExperimentRequest } from "@/server/experiments";

/**
 * Records that a visitor was shown a version of a tested page (D148): sent by the page itself once it has checked its
 * version against the visitor's cookie. The server checks all of it again (consent, the cookie, a running test).
 */
export async function POST(request: Request) {
  await connection();
  const ctx = await abRequest(request);
  if (ctx instanceof Response) return ctx;
  const { storeId, body, device } = ctx;
  const mine = await readAssignments(storeId);
  if (!mine) return quiet();
  if (!(await takeExperimentRequest(storeId, mine.visitor))) return new Response(null, { status: 429 });
  const experiment = typeof body.experiment === "string" ? body.experiment : "";
  const variant = typeof body.variant === "string" ? body.variant : "";
  const market = typeof body.market === "string" ? body.market : "";
  await recordExposure(storeId, experiment, variant, { market, device });
  return quiet();
}
