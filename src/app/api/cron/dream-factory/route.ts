import { after, connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute } from "@/server/cron-runs";
import { advanceDreamRuns } from "@/server/dream-factory";

/** A step may be a turn of the AI manager, which takes two minutes at most. */
export const maxDuration = 300;

/** The minute's run starts no step after this, so the last turn ends within `maxDuration`. */
const RUN_MS = 150_000;

/**
 * Every minute, from Supabase's scheduler: the Dream Factory's runs moved on (D409, `docs/dream-factory.md`), one at a time, each by the
 * steps that may start and the ones waiting on background work or the owner. The answer goes back at once and the work runs after it.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const deadline = Date.now() + RUN_MS;
  after(async () => {
    await advanceDreamRuns({ deadline });
  });
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.dream-factory", 60, run);
export const POST = GET;
