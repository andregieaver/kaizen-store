import { connection } from "next/server";

import { sendDueCartReminders } from "@/server/cart-reminders";
import { cronAuthorised } from "@/server/cron-auth";
import { sendDuePlanReminders } from "@/server/plan-reminders";
import { sendDueBookingReminders } from "@/server/shopper-emails";

/**
 * Every five minutes, from Supabase's scheduler: the stores' cart reminders
 * and Kaizen's plan reminders that are due (D33), and reminders before
 * appointments (D65).
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [carts, plans, bookings] = await Promise.all([
    sendDueCartReminders(),
    sendDuePlanReminders(),
    sendDueBookingReminders(),
  ]);
  return Response.json({ carts, plans, bookings }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
