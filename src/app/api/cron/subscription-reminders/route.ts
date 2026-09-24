import { timingSafeEqual } from "node:crypto";

import { connection } from "next/server";

import { sendDueReminders } from "@/server/subscription-reminders";

/** Whether the request carries the cron secret Vercel sends (D29). */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Daily: reminders before trials end and before renewals (D29). Vercel Cron calls it. */
export async function GET(request: Request) {
  await connection();
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });
  const run = await sendDueReminders();
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
