import { connection } from "next/server";

import { utcDay } from "@/lib/usage-metrics";
import { cronAuthorised } from "@/server/cron-auth";
import { pruneUsageDaily, measureDay } from "@/server/usage-meter";

export const maxDuration = 300;

/**
 * Daily at 03:17 UTC, from Supabase's scheduler (D314, `docs/capacity.md` step 1.3): what every store used. Today's gauges and the
 * counters so far, and yesterday's counters again so a late email or AI call is counted; then usage older than 25 months goes.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const now = new Date();
  const yesterday = await measureDay(utcDay(now, -1), false);
  const today = await measureDay(utcDay(now), true);
  const pruned = await pruneUsageDaily(now);
  return Response.json({ yesterday, today, pruned }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
