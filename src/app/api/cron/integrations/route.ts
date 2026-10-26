import { connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute } from "@/server/cron-runs";
import { deliverDue } from "@/server/integrations";
import { processStoreEvents } from "@/server/staff-alerts";
import { sendSupportEmails } from "@/server/support-email";
import { processInboundEmails } from "@/server/support-inbound";

/** Room before Vercel stops the run (PSI 2026-10-24, REL-06). */
export const maxDuration = 120;

/**
 * Every minute, from Supabase's scheduler: the stores' events due to go to Zapier and Make (D41), and support's emails (D216): the
 * answers to customers who left an address or wrote by email, the alerts to people when a conversation has waited, and the emails
 * received for the desks that were not processed when they arrived (D332). And the store events (D238): each paid order's
 * and requested return's automation rules and staff alerts, once each.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  // Received emails first, so an answer the AI wrote now goes out in the same run.
  const inbound = await processInboundEmails();
  const [integrations, support, storeEvents] = await Promise.all([deliverDue(), sendSupportEmails(), processStoreEvents()]);
  return Response.json({ ...integrations, support, inbound, storeEvents }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.integrations", 60, run);
export const POST = GET;
