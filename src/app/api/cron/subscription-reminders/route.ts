import { revalidateTag } from "next/cache";
import { connection } from "next/server";

import { pruneUsage } from "@/server/ai-usage";
import { fadeMemories } from "@/server/assistant-memory";
import { pruneCompanyRecords } from "@/server/companies";
import { catalogTag } from "@/server/catalog";
import { cronAuthorised } from "@/server/cron-auth";
import { refreshAutoRates } from "@/server/localization";
import { storeTag } from "@/server/stores";
import { sendDueReminders } from "@/server/subscription-reminders";

/**
 * Daily: reminders before trials end and before renewals (D29). Supabase's
 * scheduler calls it (D33), and Vercel Cron too where CRON_SECRET is set;
 * each reminder goes once whoever calls. Also lets the AI manager's unused
 * learned memories fade (D103) and AI usage older than 400 days goes (D106), and so do old invitations and sign-in links of company accounts (D108). Stores that keep their currency rates from the ECB's get the latest (D109).
 */
export async function GET(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [run, memories, usage, company, rates] = await Promise.all([sendDueReminders(), fadeMemories(), pruneUsage(), pruneCompanyRecords(), refreshAutoRates()]);
  for (const store of rates) {
    revalidateTag(storeTag(store.slug), "max");
    revalidateTag(catalogTag(store.id), "max");
  }
  return Response.json({ ...run, memories, usageDeleted: usage, companyRecordsDeleted: company, ratesRefreshed: rates.length }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = GET;
