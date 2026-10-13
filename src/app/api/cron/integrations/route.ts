import { connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { deliverDue } from "@/server/integrations";
import { sendSupportEmails } from "@/server/support-email";

/**
 * Every minute, from Supabase's scheduler: the stores' events due to go to Zapier and Make (D41), and support's emails (D216): the
 * answers to customers who left an address, and the alerts to people when a conversation has waited.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [integrations, support] = await Promise.all([deliverDue(), sendSupportEmails()]);
  return Response.json({ ...integrations, support }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
