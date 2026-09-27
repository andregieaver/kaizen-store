import { connection } from "next/server";

import { syncDueFeeds } from "@/server/calendar-sync";
import { sendDueCartReminders } from "@/server/cart-reminders";
import { cronAuthorised } from "@/server/cron-auth";
import { payHostCommissions } from "@/server/host-payments";
import { pruneSearchLog } from "@/server/search";
import { sendDuePlanReminders } from "@/server/plan-reminders";
import { sendDueBookingReminders } from "@/server/shopper-emails";

/**
 * Every five minutes, from Supabase's scheduler: the stores' cart reminders
 * and Kaizen's plan reminders that are due (D33), reminders before
 * appointments (D65), other calendars read in for rooms and items (D67),
 * stores' commissions on hosts' bookings not yet sent (D71), and searches
 * older than 90 days forgotten (Phase 2).
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [carts, plans, bookings, calendars, commissions, searches] = await Promise.all([
    sendDueCartReminders(),
    sendDuePlanReminders(),
    sendDueBookingReminders(),
    syncDueFeeds(),
    payHostCommissions(),
    pruneSearchLog(),
  ]);
  return Response.json({ carts, plans, bookings, calendars, commissions, searches }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
