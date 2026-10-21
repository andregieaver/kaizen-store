import { after, connection } from "next/server";

import { runAutomations } from "@/server/automations";
import { runBroadcasts } from "@/server/broadcasts";
import { deliverGiftCards } from "@/server/gift-card-delivery";
import { cronAuthorised } from "@/server/cron-auth";

export const maxDuration = 120;

/** A run claims no more recipients after this, so the last batch is handed over within `maxDuration` and the next minute's run seldom overlaps it (claims keep two runs apart when they do). */
const RUN_MS = 50_000;

/**
 * Every minute, from Supabase's scheduler: broadcasts (D297, docs/wave-5-marketing.md 5.3). Scheduled ones whose time came are started, those of
 * stores no longer open are stopped, and queued addresses are sent a batch at a time. The answer goes back at once and the sending happens after
 * it, so the scheduler never waits. Then the automations (D298, 6.2): welcome, after a purchase and win-back emails that are due, and back in
 * stock to every waiting address whose variant is in stock again. Then the gift cards whose day has come (D300).
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const deadline = Date.now() + RUN_MS;
  after(async () => {
    await runBroadcasts({ deadline });
    await runAutomations({ deadline });
    // Gift cards whose day has come (D300 F2), and any whose email failed before.
    await deliverGiftCards({ deadline });
  });
  return Response.json({ started: true }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
