import { after, connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute, trackedWork } from "@/server/cron-runs";
import { MAP_SHOT_MS, runMapShots } from "@/server/map-shots";
import { browserLookPhotographer, browserMapPhotographer } from "@/server/page-look-runner";
import { runLook, runPageLooks } from "@/server/page-looks";

/** A look opens Chromium once per width, which takes a while on a cold function. */
export const maxDuration = 300;

/** The minute's run starts no look after this, so the last one ends within `maxDuration`. */
const RUN_MS = 150_000;

/**
 * Looks at pages (D310, `docs/ai-autopilot.md` 9.2). Asked by the server itself with one look's id (`triggerLook()`), it takes that look
 * and answers when it is done, so a person's turn gets the findings at once; every minute, from Supabase's scheduler, it takes the looks
 * still waiting after its answer, then heatmaps' pictures (D656). The browser opens the page's draft at the address the request came to.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const origin = new URL(request.url).origin;
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const deps = { photograph: browserLookPhotographer, origin };
  if (typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id)) {
    const taken = await runLook(body.id, deps);
    return Response.json({ taken }, { headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const deadline = started + RUN_MS;
  after(async () => {
    // The route's own record says only that it answered; the work is kept as `route.page-looks.work` (bloat review step 1.26).
    await trackedWork("route.page-looks", 60, async () => {
      await runPageLooks(deadline, deps);
      // Heatmaps' pictures (D656) after the looks: a look already running can end late, so never past 270 s of the 300.
      const until = Math.min(started + 270_000, Math.max(Date.now() + 60_000, started + 120_000));
      if (until - Date.now() >= MAP_SHOT_MS) await runMapShots(until, { photograph: browserMapPhotographer });
    });
  });
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.page-looks", 60, run);
export const POST = GET;
