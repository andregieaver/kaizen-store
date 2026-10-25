import { after, connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute } from "@/server/cron-runs";
import { browserLookPhotographer } from "@/server/page-look-runner";
import { runLook, runPageLooks } from "@/server/page-looks";

/** A look opens Chromium once per width, which takes a while on a cold function. */
export const maxDuration = 300;

/** The minute's run starts no look after this, so the last one ends within `maxDuration`. */
const RUN_MS = 150_000;

/**
 * Looks at pages (D310, `docs/ai-autopilot.md` 9.2). Asked by the server itself with one look's id (`triggerLook()`), it takes that look
 * and answers when it is done, so a person's turn gets the findings at once; every minute, from Supabase's scheduler, it takes the looks
 * still waiting after its answer. The browser opens the page's draft at the address the request came to.
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
  const deadline = Date.now() + RUN_MS;
  after(async () => {
    await runPageLooks(deadline, deps);
  });
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.page-looks", 60, run);
export const POST = GET;
