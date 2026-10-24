import { connection } from "next/server";

import { utcDay } from "@/lib/usage-metrics";
import { prunePeaks, sendPeakNotices } from "@/server/capacity-events";
import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute } from "@/server/cron-runs";
import { sendUsageAlerts } from "@/server/usage-alerts";
import { pruneUsageDaily, measureDay } from "@/server/usage-meter";

export const maxDuration = 300;

/**
 * Daily at 03:17 UTC, from Supabase's scheduler (D314, `docs/capacity.md` step 1.3): what every store used. Today's gauges and the
 * counters so far, and yesterday's counters again so a late email or AI call is counted; then usage older than 25 months goes, and owners are warned about limits they near or reach.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const now = new Date();
  const yesterday = await measureDay(utcDay(now, -1), false);
  const today = await measureDay(utcDay(now), true);
  const pruned = await pruneUsageDaily(now);
  // Owners hear when a store nears or reaches its plan's limits, once per store, month and level (step 2.5).
  const alerts = await sendUsageAlerts(now);
  // Platform admins hear of very busy times 7 days and 1 day ahead (step 4.1); busy times over a year ago go.
  const [peakNotices, peaksPruned] = await Promise.all([sendPeakNotices(now), prunePeaks()]);
  return Response.json({ yesterday, today, pruned, alerts, peakNotices, peaksPruned }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.usage", 86400, run);
export const POST = GET;
