import { connection } from "next/server";

import { fadeMemories } from "@/server/assistant-memory";
import { cronAuthorised } from "@/server/cron-auth";
import { sendDueReminders } from "@/server/subscription-reminders";

/**
 * Daily: reminders before trials end and before renewals (D29). Supabase's
 * scheduler calls it (D33), and Vercel Cron too where CRON_SECRET is set;
 * each reminder goes once whoever calls. Also lets the AI manager's unused
 * learned memories fade (D103).
 */
export async function GET(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [run, memories] = await Promise.all([sendDueReminders(), fadeMemories()]);
  return Response.json({ ...run, memories }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = GET;
