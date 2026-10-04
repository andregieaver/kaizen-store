import { revalidateTag } from "next/cache";
import { connection } from "next/server";

import { pruneUsage } from "@/server/ai-usage";
import { pruneVisits } from "@/server/analytics-visits";
import { fadeMemories } from "@/server/assistant-memory";
import { pruneCompanyRecords } from "@/server/companies";
import { catalogTag } from "@/server/catalog";
import { cronAuthorised } from "@/server/cron-auth";
import { refreshAutoRates } from "@/server/localization";
import { expireWithdrawalRequests } from "@/server/return-jobs";
import { storeTag } from "@/server/stores";
import { sendDueReminders } from "@/server/subscription-reminders";
import { syncStandardRates } from "@/server/vat-admin";
import { pruneVatChecks } from "@/server/vat-checks";

/**
 * Daily: reminders before trials end and before renewals (D29). Supabase's
 * scheduler calls it (D33), and Vercel Cron too where CRON_SECRET is set;
 * each reminder goes once whoever calls. Also lets the AI manager's unused
 * learned memories fade (D103) and AI usage older than 400 days goes (D106), and so do old invitations and sign-in links of company accounts (D108). Stores that keep their currency rates from the ECB's get the latest (D109). Counted visits and product views older than 25 months go (D152). Withdrawal requests nobody confirmed within 24 hours are deleted (D153). The countries' cached standard VAT rate follows the rate in force today, so a change dated in the future takes effect on its day, a rate of any category that began or ended lately refreshes the catalogue's cached VAT labels, a shopper's VAT number is let go of by a cart that is over for 30 days, and VAT number checks older than 30 days that nothing rests on are forgotten (D157).
 */
export async function GET(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [run, memories, usage, company, rates, visits, withdrawals, vatRates, vatChecks] = await Promise.all([sendDueReminders(), fadeMemories(), pruneUsage(), pruneCompanyRecords(), refreshAutoRates(), pruneVisits(), expireWithdrawalRequests(), syncStandardRates(), pruneVatChecks()]);
  for (const store of rates) {
    revalidateTag(storeTag(store.slug), "max");
    revalidateTag(catalogTag(store.id), "max");
  }
  return Response.json({ ...run, memories, usageDeleted: usage, companyRecordsDeleted: company, ratesRefreshed: rates.length, visitsDeleted: visits.visits, productViewsDeleted: visits.productViews, withdrawalRequestsExpired: withdrawals, vatRatesChanged: vatRates.changed, vatRatesLately: vatRates.recent, vatChecksDeleted: vatChecks.deleted, vatCartsCleared: vatChecks.cartsCleared }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = GET;
