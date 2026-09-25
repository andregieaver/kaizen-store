import { connection } from "next/server";

import { sendDueCartReminders } from "@/server/cart-reminders";
import { cronAuthorised } from "@/server/cron-auth";
import { sendDuePlanReminders } from "@/server/plan-reminders";

/** Every five minutes, from Supabase's scheduler: the stores' cart reminders and Kaizen's plan reminders that are due (D33). */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [carts, plans] = await Promise.all([sendDueCartReminders(), sendDuePlanReminders()]);
  return Response.json({ carts, plans }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
