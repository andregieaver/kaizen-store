import { after, connection } from "next/server";

import { runBroadcasts } from "@/server/broadcasts";
import { cronAuthorised } from "@/server/cron-auth";

export const maxDuration = 120;

/** A run claims no more recipients after this, so the last batch is handed over within `maxDuration` and the next minute's run seldom overlaps it (claims keep two runs apart when they do). */
const RUN_MS = 50_000;

/**
 * Every minute, from Supabase's scheduler: broadcasts (D297, docs/wave-5-marketing.md 5.3). Scheduled ones whose time came are started, those of
 * stores no longer open are stopped, and queued addresses are sent a batch at a time. The answer goes back at once and the sending happens after
 * it, so the scheduler never waits.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const deadline = Date.now() + RUN_MS;
  after(() => runBroadcasts({ deadline }).then(() => undefined));
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
