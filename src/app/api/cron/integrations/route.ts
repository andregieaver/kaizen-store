import { connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { deliverDue } from "@/server/integrations";

/** Every minute, from Supabase's scheduler: the stores' events due to go to Zapier and Make (D41). */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  return Response.json(await deliverDue(), { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
