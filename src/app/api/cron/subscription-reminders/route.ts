import { pruneAdSignals } from "@/server/ad-conversions";
import { revalidateTag } from "next/cache";
import { connection } from "next/server";

import { pruneUsage } from "@/server/ai-usage";
import { pruneSpeedSamples } from "@/server/analytics-speed";
import { pruneVisits } from "@/server/analytics-visits";
import { fadeMemories } from "@/server/assistant-memory";
import { resumeErasures } from "@/server/privacy-erasure";
import { sendDueReminders as sendPrivacyReminders } from "@/server/privacy-requests";
import { runRetention } from "@/server/retention";
import { pruneCompanyRecords } from "@/server/companies";
import { storeEcbRates } from "@/server/ecb-rates";
import { catalogTag } from "@/server/catalog";
import { cronAuthorised } from "@/server/cron-auth";
import { trackedRoute } from "@/server/cron-runs";
import { pruneDataJobs } from "@/server/data-jobs";
import { expireGiftCards } from "@/server/gift-cards-admin";
import { prunePageJobs } from "@/server/site-tools";
import { prunePageLooks } from "@/server/page-looks";
import { pruneResearch } from "@/server/research";
import { pruneAutopilotEvents } from "@/server/autopilot-events";
import { pruneInboundEmails } from "@/server/support-inbound";
import { pruneNotFound } from "@/server/not-found";
import { pruneThemeDetaches } from "@/server/theme-detach";
import { pruneThemeUpdates } from "@/server/design-presets";
import { refreshAutoRates } from "@/server/localization";
import { expireWithdrawalRequests } from "@/server/return-jobs";
import { runSecurityJobs } from "@/server/security-jobs";
import { storeTag } from "@/server/stores";
import { sendDueReminders } from "@/server/subscription-reminders";
import { syncStandardRates } from "@/server/vat-admin";
import { pruneVatChecks } from "@/server/vat-checks";
import { pruneAutomations } from "@/server/automations";
import { pruneReviewPictureFiles } from "@/server/review-picture-store";
import { pruneReviewRequests } from "@/server/review-requests";
import { pruneBroadcastRecipients } from "@/server/broadcasts";
import { pruneStockRequests } from "@/server/stock-requests";
import { pruneSubscribers } from "@/server/marketing-subscribers";
import { runDomainRenewals } from "@/server/domain-purchases";
import { sendRenewalReminders } from "@/server/domain-emails";
import { runDomainMoves } from "@/server/domain-move";
import { checkArrivals } from "@/server/domain-move-in";

/** Room before Vercel stops the run (PSI 2026-10-24, REL-06). */
export const maxDuration = 300;

/**
 * Daily: reminders before trials end and before renewals (D29). Supabase's
 * scheduler calls it (D33), and Vercel Cron too where CRON_SECRET is set;
 * each reminder goes once whoever calls. Also lets the AI manager's unused
 * learned memories fade (D103) and AI usage older than 400 days goes (D106), and so do old invitations and sign-in links of company accounts (D108). Stores that keep their currency rates from the ECB's get the latest (D109). Counted visits and product views older than 25 months go (D152). Withdrawal requests nobody confirmed within 24 hours are deleted (D153). Personal data (wave 1, 1g, D162): the retention schedule runs (documents and orders past their bookkeeping period are anonymised, old emails, carts, quotes, sign-in codes, sessions and payment payloads are cleaned), erasures that began and did not finish are resumed, and owners are reminded of privacy requests that are due. Collaborators whose time ran out are ended, activity-log entries older than 24 months and spent recovery codes older than 12 months are removed (wave 1, 1f). The countries' cached standard VAT rate follows the rate in force today, so a change dated in the future takes effect on its day, a rate of any category that began or ended lately refreshes the catalogue's cached VAT labels, a shopper's VAT number is let go of by a cart that is over for 30 days, and VAT number checks older than 30 days that nothing rests on are forgotten (D157). The ECB's latest euro reference rates are stored once, never replacing a stored day, for the OSS and IOSS return data (D161, never throws: a failure is logged and the rest goes on). Imports' and exports' files and records are cleaned up (wave 2, D165, never throws): an export's files 7 days after it is done, an import's file 30 days after it ends, a job's items and pictures after 90 days and its row after 12 months, bulk edits after 90 days. The 404 report's rows go 90 days after their day (wave 2, D168, `pruneNotFound()`, never throws). Runs of the theme migration older than 90 days can no longer be undone and go (D243, `pruneThemeDetaches()`, never throws), and so do updates of installed themes (D245, `pruneThemeUpdates()`, never throws). Marketing sign-ups whose confirmation link ran out more than 30 days ago go with their history (D295, `pruneSubscribers()`, never throws). A broadcast's recipients go 90 days after its send ended, its figures kept (D297, `pruneBroadcastRecipients()`, never throws). Automation sends older than 90 days go, and back-in-stock requests unconfirmed past their link, waiting for 180 days or ended 30 days ago (D298, `pruneAutomations()`, `pruneStockRequests()`, never throw). What is left on a gift card past its date expires, once (D300 F4, `expireGiftCards()`, never throws). The AI manager's page work done, given up or gone goes after 30 days (D308, `prunePageJobs()`, never throws). Review request rows older than 400 days go (D301 G3, `pruneReviewRequests()`, never throws), and files of reviews' pictures whose row is gone (D301 G4, `pruneReviewPictureFiles()`, never throws). Looks at pages older than 30 days go (D310, `prunePageLooks()`, never throws). Web addresses the AI searched or read go after 90 days (D329, `pruneResearch()`, never throws). Speed samples go after 90 days (D336, `pruneSpeedSamples()`, never throws).
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [run, memories, usage, company, rates, visits, withdrawals, security, vatRates, vatChecks, ecb, speedSamplesPruned] = await Promise.all([sendDueReminders(), fadeMemories(), pruneUsage(), pruneCompanyRecords(), refreshAutoRates(), pruneVisits(), expireWithdrawalRequests(), runSecurityJobs(), syncStandardRates(), pruneVatChecks(), storeEcbRates(), pruneSpeedSamples()]);
  // Ad platforms' ids on orders go 90 days after (D303 I2).
  await pruneAdSignals();
  // GDPR (wave 1, 1g): the retention schedule, erasures that began and did not finish, and the reminders about requests due. Each never throws.
  // Domains (D315, never throws): renewals invoiced 30 days ahead, the registrar's auto-renew turned off where renewal is off or unpaid.
  const domainRenewals = await runDomainRenewals().catch((error) => (console.error("[domains] renewals failed", error), { quoted: 0, stopped: 0 }));
  // The holder hears of a renewal not paid or switched off at 30, 14, 7 and 1 days (D315 9.1), after the renewals are invoiced.
  const domainReminders = await sendRenewalReminders().catch((error) => (console.error("[domains] reminders failed", error), 0));
  // Domains moving away (D315 8, never throws): transfers followed until done, zones kept 30 days after their nameservers moved let go.
  const domainMoves = await runDomainMoves().catch((error) => (console.error("[domains] moves failed", error), { moved: 0, given_up: 0, zonesLeft: 0 }));
  // Zones moving here (D315 5.4, never throws): arrived once public DNS shows only Vercel's nameservers for them.
  const domainsArrived = (await checkArrivals().catch((error) => (console.error("[domains] arrivals failed", error), []))).length;
  const [retention, erasures, privacyReminders, dataJobs, notFoundDeleted, themeDetachesDeleted, themeUpdatesDeleted, subscribersPruned, broadcastsPruned, automationsPruned, stockRequestsPruned, giftCardsExpired, pageJobsPruned, reviewRequestsPruned, reviewPictureFiles, pageLooksPruned, researchPruned, autopilotEventsPruned, inboundEmailsPruned] = await Promise.all([runRetention(), resumeErasures().catch((error) => (console.error("[privacy] resume failed", error), { resumed: 0, failed: 0 })), sendPrivacyReminders().catch((error) => (console.error("[privacy] reminders failed", error), { dueSoon: 0, overdue: 0 })), pruneDataJobs(), pruneNotFound(), pruneThemeDetaches().catch((error) => (console.error("[theme-detach] prune failed", error), 0)), pruneThemeUpdates().catch((error) => (console.error("[theme-updates] prune failed", error), 0)), pruneSubscribers().catch((error) => (console.error("[subscribers] prune failed", error), 0)), pruneBroadcastRecipients().catch((error) => (console.error("[broadcasts] prune failed", error), 0)), pruneAutomations().catch((error) => (console.error("[automations] prune failed", error), 0)), pruneStockRequests().catch((error) => (console.error("[stock-requests] prune failed", error), 0)), expireGiftCards(), prunePageJobs().catch((error) => (console.error("[page-jobs] prune failed", error), 0)), pruneReviewRequests().catch((error) => (console.error("[review-requests] prune failed", error), 0)), pruneReviewPictureFiles().catch((error) => (console.error("[review-pictures] sweep failed", error), { removed: 0 })), prunePageLooks().catch((error) => (console.error("[page-looks] prune failed", error), 0)), pruneResearch(), pruneAutopilotEvents().catch((error) => (console.error("[autopilot-events] prune failed", error), 0)), pruneInboundEmails().catch((error) => (console.error("[support-inbound] prune failed", error), 0))]);
  for (const store of rates) {
    revalidateTag(storeTag(store.slug), "max");
    revalidateTag(catalogTag(store.id), "max");
  }
  return Response.json({ ...run, memories, usageDeleted: usage, companyRecordsDeleted: company, ratesRefreshed: rates.length, visitsDeleted: visits.visits, productViewsDeleted: visits.productViews, speedSamplesPruned, withdrawalRequestsExpired: withdrawals, ...security, vatRatesChanged: vatRates.changed, vatRatesLately: vatRates.recent, vatChecksDeleted: vatChecks.deleted, vatCartsCleared: vatChecks.cartsCleared, retention: { counts: retention.counts, errors: retention.errors, filesLeft: retention.filesLeft.length }, erasuresResumed: erasures.resumed, erasuresFailed: erasures.failed, privacyRemindersDueSoon: privacyReminders.dueSoon, privacyRemindersOverdue: privacyReminders.overdue, ecbRatesStored: ecb.inserted, ecbRatesDiffering: ecb.differing, ecbRatesOk: ecb.ok, dataJobs, notFoundDeleted, themeDetachesDeleted, themeUpdatesDeleted, subscribersPruned, broadcastsPruned, automationsPruned, stockRequestsPruned, giftCardsExpired, pageJobsPruned, reviewRequestsPruned, reviewPicturesSwept: reviewPictureFiles.removed, pageLooksPruned, researchPruned, autopilotEventsPruned, inboundEmailsPruned, domainRenewals, domainReminders, domainMoves, domainsArrived }, { headers: { "Cache-Control": "no-store" } });
}

// Kept in commerce.cron_jobs (PSI 2026-10-24, REL-06): the platform home says when it is late or failing.
export const GET = trackedRoute("route.subscription-reminders", 86400, run);
export const POST = GET;
