import { connection } from "next/server";

import { cronHeartbeat } from "@/lib/cron-health";
import { cronJobRows } from "@/server/cron-runs";
import { log } from "@/server/log";

/**
 * The outside heartbeat (`docs/100-day-challenge.md` F3, D672, PSI REL-06): an uptime service outside Kaizena Flow asks this every few minutes
 * and pages when it does not answer 200. A dead scheduler takes the in-house checks with it (the failing-job emails and the stall watch run
 * on it); this answers 503 when a scheduled route has finished no run for longer than its schedule allows (`cronHeartbeat()`), and when the
 * ledger cannot be read. Public: counts only, never a job's error.
 */
export async function GET() {
  await connection();
  try {
    const beat = cronHeartbeat(await cronJobRows());
    return Response.json(beat, { status: beat.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    log("error", "health.cron_failed", {}, error);
    return Response.json({ ok: false, unread: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
