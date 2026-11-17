import { connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute } from "@/server/cron-runs";
import { runWatchdog } from "@/server/watchdog";

export const maxDuration = 30;

/**
 * Every fifteen minutes, from Vercel's cron (bloat review step 1.22, the one thing it schedules): the watcher outside Supabase's scheduler.
 * It reads the dispatcher's row in the ledger and emails the platform's admins when the scheduler has stopped; it runs no job. Vercel's cron
 * sends `Authorization: Bearer <CRON_SECRET>` and calls with GET.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  return Response.json(await runWatchdog(), { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the status page's jobs check fails when this row is late.
export const GET = trackedRoute("route.watchdog", 900, run);
export const POST = GET;
