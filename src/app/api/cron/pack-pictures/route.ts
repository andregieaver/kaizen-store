import { after, connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute } from "@/server/cron-runs";
import { refreshPackStores, runPackPictures } from "@/server/content-packs";

/** A picture takes the model up to 150 seconds, and placing it a few more: a run starts none after `RUN_MS`, so the last ends in time. */
export const maxDuration = 300;

const RUN_MS = 120_000;

/**
 * Every minute, from Supabase's scheduler: the next pictures content packs are asked for (D271). The answer goes back at once and the
 * pictures are made after it, so the scheduler never waits on the picture model.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const until = Date.now() + RUN_MS;
  after(async () => {
    const result = await runPackPictures(until);
    refreshPackStores(result.stores);
  });
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.pack-pictures", 60, run);
export const POST = GET;
