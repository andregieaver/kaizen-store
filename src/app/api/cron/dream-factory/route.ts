import { after, connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { tracked, trackedRoute } from "@/server/cron-runs";
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
  // The work runs after the answer, so the route's own record says only that it answered: the work is kept as a job of its own, and a
  // minute whose runs threw shows as failing on the platform home.
  after(async () => {
    await tracked("dream-factory.advance", 60, async () => {
      // One run's fault never stops the others (each is logged); the minute is kept as failed when any run threw.
      const { failed } = await advanceDreamRuns({ deadline });
      if (failed > 0) throw new Error(`${failed} Dream Factory run(s) failed this minute.`);
    });
  });
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.dream-factory", 60, run);
export const POST = GET;
