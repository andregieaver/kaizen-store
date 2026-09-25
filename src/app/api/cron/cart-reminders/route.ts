import { connection } from "next/server";

import { sendDueCartReminders } from "@/server/cart-reminders";
import { cronAuthorised } from "@/server/cron-auth";

/** Every five minutes, from Supabase's scheduler: the cart reminders that are due (D33). */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const result = await sendDueCartReminders();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
