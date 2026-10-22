import { after, connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { runPageJobs } from "@/server/site-tools";

/** A build plans and writes for a minute or two, a picture takes the model up to 150 seconds: a run starts none after `RUN_MS`. */
export const maxDuration = 300;

const RUN_MS = 60_000;

/**
 * Every minute, from Supabase's scheduler: the pages the AI manager was asked to build and the pictures it asked for (D308). The answer
 * goes back at once and the work is done after it, so the scheduler never waits on the site's AI.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const until = Date.now() + RUN_MS;
  after(() => runPageJobs(until));
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
