import { after, connection } from "next/server";

import { runEvents } from "@/server/autopilot-events";
import { runGoalReviews } from "@/server/autopilot-reviews";
import { runAutopilot } from "@/server/autopilot-runner";
import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute } from "@/server/cron-runs";

export const maxDuration = 300;

/** A run starts no step after this, so the last task's turn (two minutes at most) ends within `maxDuration`. */
const RUN_MS = 150_000;

/**
 * Every minute, from Supabase's scheduler: the autopilot's next steps (D309, `docs/ai-autopilot.md` 7.3), a few at a time and one per store,
 * each in the name of the person whose plan it is, then the goals due a review (D328), then the events to react to (D331). The answer goes back at once and the steps run after it, so the scheduler never waits.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const deadline = Date.now() + RUN_MS;
  after(async () => {
    await runAutopilot({ deadline });
    // Then the goals due a look (D328): a review makes the next plan once a goal's plan ended, and on a schedule.
    await runGoalReviews({ deadline });
    // Then what happened (D331): a customer waiting for a person, a test that ended by itself, an urgent alert.
    await runEvents({ deadline });
  });
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.autopilot", 60, run);
export const POST = GET;
