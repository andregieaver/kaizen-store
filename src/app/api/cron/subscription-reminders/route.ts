import { connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { sendDueReminders } from "@/server/subscription-reminders";

/**
 * Daily: reminders before trials end and before renewals (D29). Supabase's
 * scheduler calls it (D33), and Vercel Cron too where CRON_SECRET is set;
 * each reminder goes once whoever calls.
 */
export async function GET(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const run = await sendDueReminders();
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}

export const POST = GET;
