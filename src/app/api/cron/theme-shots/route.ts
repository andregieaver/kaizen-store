import { revalidateTag } from "next/cache";
import { after, connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { DESIGNS_TAG } from "@/server/design-presets";
import { browserPhotographer } from "@/server/theme-shot-runner";
import { runThemeShots } from "@/server/theme-shots";

/** Each look opens Chromium of its own, which takes a while to start on a cold function; a run takes looks while it has time. */
export const maxDuration = 120;

/** A run stops starting looks this long after the request came, so the last one ends within `maxDuration`. */
const RUN_MS = 100_000;

/**
 * Every minute, from Supabase's scheduler: the next photographs of published themes' looks (`docs/theme-showcase-phase-2.md` step 1).
 * The answer goes back at once and the looks are taken after it, so the scheduler never waits on a browser. The browser opens this site's
 * own public preview, at the address the request came to.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const origin = new URL(request.url).origin;
  after(async () => {
    const result = await runThemeShots(origin, started + RUN_MS, { photograph: browserPhotographer });
    // The theme store's cards, pages and share images follow the pictures made.
    if (result.done > 0) revalidateTag(DESIGNS_TAG, "max");
  });
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
