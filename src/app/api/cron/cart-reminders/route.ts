import { revalidateTag } from "next/cache";
import { connection } from "next/server";

import { refreshAltTexts } from "@/server/alt-texts";
import { runAffiliateJobs } from "@/server/affiliate-emails";
import { runBonusJobs } from "@/server/bonus";
import { syncDueFeeds } from "@/server/calendar-sync";
import { sendDueCartReminders } from "@/server/cart-reminders";
import { catalogTag } from "@/server/catalog";
import { pruneChatUsage } from "@/server/chat-agent";
import { endIdleConversations } from "@/server/support";
import { expireActions } from "@/server/support-actions";
import { summarisePending } from "@/server/support-summary";
import { cronAuthorised } from "@/server/cron-auth";
import { expireDrafts } from "@/server/draft-orders";
import { archiveFinishedOrders } from "@/server/order-archive";
import { expireOrderEdits } from "@/server/order-edits";
import { runDataJobs } from "@/server/data-jobs";
import { refreshEmbeddings } from "@/server/embeddings";
import { runExperimentJobs } from "@/server/experiment-jobs";
import { invoiceJobs } from "@/server/invoice-issue";
import { runPaymentJobs } from "@/server/payment-disputes";
import { pruneReplications } from "@/server/replicate-store";
import { runReturnJobs } from "@/server/return-jobs";
import { pruneFormSubmissions } from "@/server/forms";
import { pruneRecommendEvents } from "@/server/recommend-events";
import { pruneSearchCache } from "@/server/search-cache";
import { refreshKnowledge } from "@/server/knowledge";
import { refreshMediaEmbeddings } from "@/server/media-library";
import { PAGES_TAG, pagesTag } from "@/server/pages";
import { DESIGNS_TAG, designTags, runPlatformThemeUpdates, runThemeUpdates } from "@/server/design-presets";
import { chargeDomainPurchases, registerPaidDomains } from "@/server/domain-purchases";
import { chargeDueThemePurchases } from "@/server/theme-prices";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";
import { payHostCommissions } from "@/server/host-payments";
import { pruneSearchLog } from "@/server/search";
import { sendDuePlanReminders } from "@/server/plan-reminders";
import { sendDueBookingReminders } from "@/server/shopper-emails";
import { sendLowStockNotices } from "@/server/stock-alerts";
import { pollTracking } from "@/server/shipment-tracking";
import { sendDueSummaries } from "@/server/staff-alerts";
import { prepareDueDeliveries } from "@/server/standing-orders";
import { runStoreCopies } from "@/server/store-copy";
import { prepareDueRecurringWork } from "@/server/work-recurring";

/**
 * Every five minutes, from Supabase's scheduler: the stores' cart reminders
 * and Kaizen's plan reminders that are due (D33), reminders before
 * appointments (D65), other calendars read in for rooms and items (D67),
 * stores' commissions on hosts' bookings not yet sent (D71), searches
 * older than 90 days and search answers older than 30 forgotten (Phase 2),
 * products' vectors for search by meaning brought up to date (D74), and
 * the chat agents' knowledge cut anew from pages published since, with its
 * vectors, and their counts older than two days forgotten (D81); media
 * libraries' vectors for search by meaning (D88); and alt texts written by
 * the sites' AI for new pictures (D89), whose pages and catalogues then
 * show them; and shoppers' weekly delivery lists whose cutoff has passed
 * made into that delivery's orders (D102); and Work's repeating invoices
 * that are due made as drafts, and issued and emailed where their owner
 * switched that on (D122, never throws); and one duplicated store's copy
 * (pictures, customers, order history) taken up where it stopped (D129,
 * never throws); and the bonus program's upkeep (D130, never throws): credits
 * past their expiry written off, a reminder to those whose credits expire
 * soon, and credits held by unpaid orders given back; and the referral program's emails (D131, never throws): the
 * customers whose friends' orders earned them credits are told, once per order; and recommendation events older than 90 days
 * forgotten (D139); and A/B tests' upkeep (D148, never throws): tests past their end stopped, guardrails looked at, old
 * carts' visitors forgotten; and copies of other websites' pages (D150) older than thirty days forgotten with their pictures; and withdrawals and returns (D153, never throws): a reminder to the store, once per return, when a refund is past its legal deadline, and the acknowledgement of a confirmed withdrawal tried again when the first email never got out; and invoices and credit notes (D159, never throws): refunds Stripe left pending asked of Stripe, invoices that waited for the seller's details issued, credit notes that waited for their invoice issued, and the stand-alone email for a document issued later than its payment or refund (no Chromium here: the PDFs are `/api/cron/document-pdfs`); and imports and exports (wave 2, D165, never throws): jobs nobody holds taken up where their cursor is (a dry run, an apply, an export), a few at a time within the time; and the low-stock notices (wave 3, D172, never throws): one email per store to its owners listing the variants that crossed the warning level they set since the last run (the history of stock is pruned daily, `runRetention()`); and the orders' upkeep (wave 3, D173, never throws): draft orders whose pay link ran out expired (their Stripe sessions closed first, an order paid in the last minute left alone, the unpaid order cancelled and its stock given back, its number kept so the sequence has no gap), and, for the open stores whose owner chose it, finished orders archived (up to 200 a store a run); and support (D216, never throws): conversations with the AI that went quiet for the desk's time ended; and notifications (wave 3, D238, never throw): tracked parcels' carriers asked (at most 60 parcels a run, 4 calls at once, 4 s each), their events kept, the out-for-delivery and delivered emails sent where switched on and a verified delivery recorded, and the staff summaries due at their hour sent; and installed themes that follow updates brought to their theme's latest version, a few a run (D245, never throws); and premium themes due to be paid invoiced through Kaizena Flow's billing (D286, never throws); and payments (D288, never throws): the method and risk of captured Stripe payments the reply did not read, and staff told once when a dispute's evidence is due within three days.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [carts, plans, bookings, calendars, commissions, searches, embeddings, cache, knowledge, chat, media, altTexts, forms, deliveries, recurring, storeCopies, bonus, affiliates, recommendations, experiments, replications, returns, invoices, dataJobs, lowStock, draftExpiry, autoArchive, editExpiry, supportIdle, , , tracking, summaries, payments] = await Promise.all([
    sendDueCartReminders(),
    sendDuePlanReminders(),
    sendDueBookingReminders(),
    syncDueFeeds(),
    payHostCommissions(),
    pruneSearchLog(),
    refreshEmbeddings(),
    pruneSearchCache(),
    refreshKnowledge(),
    pruneChatUsage(),
    refreshMediaEmbeddings(),
    refreshAltTexts(),
    pruneFormSubmissions(),
    prepareDueDeliveries(),
    prepareDueRecurringWork(),
    runStoreCopies(),
    runBonusJobs(),
    runAffiliateJobs(),
    pruneRecommendEvents(),
    runExperimentJobs(),
    pruneReplications(),
    runReturnJobs(),
    invoiceJobs(),
    runDataJobs(),
    sendLowStockNotices(),
    expireDrafts().catch((error) => {
      console.error("[cron] draft expiry failed", error);
      return null;
    }),
    archiveFinishedOrders().catch((error) => {
      console.error("[cron] automatic archiving failed", error);
      return null;
    }),
    // Order changes whose pay link ran out (D174): sessions closed first, a change paid in the last minute applied, the held units released.
    expireOrderEdits().catch((error) => {
      console.error("[cron] order change expiry failed", error);
      return null;
    }),
    // Support (D216): conversations with the AI that nobody has written in for the desk's time end, so their period begins.
    endIdleConversations().catch((error) => {
      console.error("[cron] ending idle support conversations failed", error);
      return null;
    }),
    // Support (D216, step 7): the summaries of ended conversations not yet written, each tried again until it is done or failed.
    summarisePending().catch((error) => {
      console.error("[cron] support summaries failed", error);
      return null;
    }),
    // Support (D216, step 10): proposals nobody confirmed in time are marked expired.
    expireActions().catch((error) => {
      console.error("[cron] support action expiry failed", error);
      return null;
    }),
    // Notifications (D238): parcels followed at their carriers, and the staff summaries that are due.
    pollTracking().catch((error) => {
      console.error("[cron] parcel tracking failed", error);
      return null;
    }),
    sendDueSummaries().catch((error) => {
      console.error("[cron] staff summaries failed", error);
      return null;
    }),
    // Payments (D288): what a captured Stripe payment was, for any the reply missed, and disputes whose evidence is due within three days.
    runPaymentJobs(),
  ]);
  // Installed themes that follow updates and are behind their theme's latest version (D245, never throws); the stores' pages then show it.
  const themeUpdates = await runThemeUpdates().catch((error) => {
    console.error("[cron] theme updates failed", error);
    return { updated: 0, refused: 0, stores: [] };
  });
  for (const store of themeUpdates.stores) for (const tag of designTags(store)) revalidateTag(tag, "max");
  // Kaizena Flow's own installed themes that follow updates (D253, never throws); its site shows the new look when the live one moved.
  const platformThemeUpdates = await runPlatformThemeUpdates().catch((error) => {
    console.error("[cron] Kaizena Flow's theme updates failed", error);
    return { updated: 0, refused: 0, live: false };
  });
  if (platformThemeUpdates.updated > 0) for (const tag of [PLATFORM_NAVIGATION_TAG, PAGES_TAG, DESIGNS_TAG]) revalidateTag(tag, "max");
  // Premium themes due to be paid (D286, never throws): invoiced through Kaizena Flow's billing, a few a run; a try that failed waits.
  const themePurchases = await chargeDueThemePurchases();
  // Domains (D315, never throw): purchases invoiced, paid ones registered and followed until done (connecting the store), failed ones refunded.
  const domainPurchases = await chargeDomainPurchases().catch((error) => (console.error("[domains] invoicing failed", error), { invoiced: 0, failed: 0 }));
  const domainRegistrations = await registerPaidDomains().catch((error) => (console.error("[domains] registering failed", error), { done: 0, failed: 0 }));
  for (const owner of altTexts.owners) {
    revalidateTag(pagesTag(owner.storeId), "max");
    if (owner.storeId) revalidateTag(catalogTag(owner.storeId), "max");
  }
  return Response.json(
    { carts, plans, bookings, calendars, commissions, searches, embeddings, cache, knowledge, chat, media, altTexts: altTexts.written, forms, deliveries, recurring, storeCopies, bonus, affiliates, recommendations, experiments, replications, returns, invoices, dataJobs, lowStock, draftExpiry, autoArchive, editExpiry, supportIdle, tracking, summaries, payments, themeUpdates: { updated: themeUpdates.updated, refused: themeUpdates.refused }, platformThemeUpdates: { updated: platformThemeUpdates.updated, refused: platformThemeUpdates.refused }, themePurchases, domainPurchases, domainRegistrations },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = run;
export const POST = run;
