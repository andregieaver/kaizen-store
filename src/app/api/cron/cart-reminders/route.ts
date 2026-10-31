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
import { reencryptSecrets } from "@/server/secret-rotation";
import { expireAssistantApprovals } from "@/server/owner-assistant";
import { runJobs, tracked } from "@/server/cron-runs";
import { expireDrafts } from "@/server/draft-orders";
import { expireApprovals } from "@/server/company-approvals";
import { archiveFinishedOrders } from "@/server/order-archive";
import { expireOrderEdits } from "@/server/order-edits";
import { runDataJobs } from "@/server/data-jobs";
import { refreshEmbeddings } from "@/server/embeddings";
import { runExperimentJobs } from "@/server/experiment-jobs";
import { runFollowUps } from "@/server/follow-up-runner";
import { sendAutopilotReports } from "@/server/autopilot-reports";
import { sendScheduledReports } from "@/server/report-schedules";
import { invoiceJobs } from "@/server/invoice-issue";
import { readDueLegalSources } from "@/server/legal-sources";
import { runLegalUpkeep, runLegalWrites } from "@/server/legal-writer";
import { runPaymentJobs } from "@/server/payment-disputes";
import { keepStripeWebhooksCurrent } from "@/server/stripe-endpoints";
import { runLiveDrills } from "@/server/live-drills";
import { pruneReplications } from "@/server/replicate-store";
import { runReturnJobs } from "@/server/return-jobs";
import { pruneFormSubmissions } from "@/server/forms";
import { pruneRecommendEvents } from "@/server/recommend-events";
import { pruneSearchCache } from "@/server/search-cache";
import { refreshKnowledge } from "@/server/knowledge";
import { refreshMediaEmbeddings } from "@/server/media-library";
import { PAGES_TAG, pagesTag } from "@/server/pages";
import { runSchedules } from "@/server/page-schedules";
import { refreshVatLabelsAtMidnight } from "@/server/vat-admin";
import { runStatusChecks, STATUS_TAG } from "@/server/status";
import { DESIGNS_TAG, designTags, runPlatformThemeUpdates, runThemeUpdates } from "@/server/design-presets";
import { chargeDomainPurchases, registerPaidDomains } from "@/server/domain-purchases";
import { chargeDueThemePurchases } from "@/server/theme-prices";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";
import { payHostCommissions } from "@/server/host-payments";
import { pruneSearchLog } from "@/server/search";
import { pruneApiIdempotency } from "@/server/api-idempotency";
import { pruneContentReports } from "@/server/content-reports";
import { runContentModeration } from "@/server/content-moderation";
import { sendDuePlanReminders } from "@/server/plan-reminders";
import { sendDueBookingReminders } from "@/server/shopper-emails";
import { sendLowStockNotices } from "@/server/stock-alerts";
import { pollTracking } from "@/server/shipment-tracking";
import { sendAnalyticsAlertEmails, sendDueSummaries } from "@/server/staff-alerts";
import { prepareDueDeliveries } from "@/server/standing-orders";
import { runStoreCopies } from "@/server/store-copy";
import { prepareDueRecurringWork } from "@/server/work-recurring";

/** Room for the slower jobs (a store copy, the embeddings) before Vercel stops the run (PSI 2026-10-24, REL-06). */
export const maxDuration = 300;

/** Supabase's scheduler runs this every five minutes. */
const EVERY = 300;

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
 * carts' visitors forgotten; and copies of other websites' pages (D150) older than thirty days forgotten with their pictures; and withdrawals and returns (D153, never throws): a reminder to the store, once per return, when a refund is past its legal deadline, and the acknowledgement of a confirmed withdrawal tried again when the first email never got out; and invoices and credit notes (D159, never throws): refunds Stripe left pending asked of Stripe, invoices that waited for the seller's details issued, credit notes that waited for their invoice issued, and the stand-alone email for a document issued later than its payment or refund (no Chromium here: the PDFs are `/api/cron/document-pdfs`); and imports and exports (wave 2, D165, never throws): jobs nobody holds taken up where their cursor is (a dry run, an apply, an export), a few at a time within the time; and the low-stock notices (wave 3, D172, never throws): one email per store to its owners listing the variants that crossed the warning level they set since the last run (the history of stock is pruned daily, `runRetention()`); and the orders' upkeep (wave 3, D173, never throws): draft orders whose pay link ran out expired (their Stripe sessions closed first, an order paid in the last minute left alone, the unpaid order cancelled and its stock given back, its number kept so the sequence has no gap), and, for the open stores whose owner chose it, finished orders archived (up to 200 a store a run); and support (D216, never throws): conversations with the AI that went quiet for the desk's time ended; and notifications (wave 3, D238, never throw): tracked parcels' carriers asked (at most 60 parcels a run, 4 calls at once, 4 s each), their events kept, the out-for-delivery and delivered emails sent where switched on and a verified delivery recorded, and the staff summaries due at their hour sent; and installed themes that follow updates brought to their theme's latest version, a few a run (D245, never throws); and premium themes due to be paid invoiced through Kaizena Flow's billing (D286, never throws); and payments (D288, never throws): the method and risk of captured Stripe payments the reply did not read, and staff told once when a dispute's evidence is due within three days; and pages and articles scheduled to be published (D341, never throws), their drafts published in the name of who scheduled them while they still may; and the catalogue's VAT labels refreshed in the first minutes of a country's day when a rate begins or ends (D379, never throws).
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  return (await tracked("route.cart-reminders", EVERY, () => dispatch())) ?? Response.json({ failed: true }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

/**
 * The jobs, side by side, each kept in `commerce.cron_jobs` as `dispatcher.{name}` in kebab case (PSI 2026-10-24, REL-06): one that throws is logged
 * and recorded and answers null, and the others finish. The platform home lists a job that is late or keeps failing.
 */
async function dispatch() {
  const r = await runJobs("dispatcher", EVERY, {
    carts: () => sendDueCartReminders(),
    plans: () => sendDuePlanReminders(),
    bookings: () => sendDueBookingReminders(),
    calendars: () => syncDueFeeds(),
    commissions: () => payHostCommissions(),
    searches: () => pruneSearchLog(),
    // Admin API answers kept for an Idempotency-Key (PSI DATA-03), 24 hours.
    apiIdempotency: () => pruneApiIdempotency(),
    // The sender of a notice of illegal content (DSA, D411) is forgotten 12 months after its decision.
    contentReports: () => pruneContentReports(),
    // An AI reads the notices still waiting and checks new and changed listings (D411 part 2); a person decides every one.
    contentModeration: () => runContentModeration(),
    embeddings: () => refreshEmbeddings(),
    cache: () => pruneSearchCache(),
    knowledge: () => refreshKnowledge(),
    chat: () => pruneChatUsage(),
    media: () => refreshMediaEmbeddings(),
    altTexts: () => refreshAltTexts(),
    forms: () => pruneFormSubmissions(),
    deliveries: () => prepareDueDeliveries(),
    recurring: () => prepareDueRecurringWork(),
    storeCopies: () => runStoreCopies(),
    bonus: () => runBonusJobs(),
    affiliates: () => runAffiliateJobs(),
    recommendations: () => pruneRecommendEvents(),
    experiments: () => runExperimentJobs(),
    replications: () => pruneReplications(),
    returns: () => runReturnJobs(),
    invoices: () => invoiceJobs(),
    dataJobs: () => runDataJobs(),
    lowStock: () => sendLowStockNotices(),
    draftExpiry: () => expireDrafts(),
    // Company orders (D321 C.2) that waited for approval, or for payment after it, longer than the window: cancelled, their stock let go.
    approvalExpiry: () => expireApprovals(),
    autoArchive: () => archiveFinishedOrders(),
    // Order changes whose pay link ran out (D174): sessions closed first, a change paid in the last minute applied, the held units released.
    editExpiry: () => expireOrderEdits(),
    // Support (D216): conversations with the AI that nobody has written in for the desk's time end, so their period begins.
    supportIdle: () => endIdleConversations(),
    // Support (D216, step 7): the summaries of ended conversations not yet written, each tried again until it is done or failed.
    supportSummaries: () => summarisePending(),
    // Support (D216, step 10): proposals nobody confirmed in time are marked expired.
    supportActions: () => expireActions(),
    // Notifications (D238): parcels followed at their carriers, and the staff summaries that are due.
    tracking: () => pollTracking(),
    summaries: () => sendDueSummaries(),
    // Analytics alerts by email (D348): once a store day after 20:00, each alert once, to the staff chosen for them.
    analyticsAlerts: () => sendAnalyticsAlertEmails(),
    // Payments (D288): what a captured Stripe payment was, for any the reply missed, and disputes whose evidence is due within three days.
    payments: () => runPaymentJobs(),
    // Kaizena Flow's Stripe endpoints kept at the site's own address: Stripe follows no redirect (consolidation, 29 October 2026).
    stripeWebhooks: () => keepStripeWebhooksCurrent(),
    // Live drills (D406): a requested run of a test-mode store's money paths (refunds, marking sent, payment facts, webhooks), its results kept.
    liveDrills: () => runLiveDrills(),
    // The AI manager's follow-ups (PSI AGT-04): a few due ones given back to it, in the asker's name, and the asker emailed.
    followUps: () => runFollowUps(),
    // The autopilot's daily digests and weekly reports (D309), to the people whose plans ran lately.
    autopilotReports: () => sendAutopilotReports(),
    // Saved reports emailed on their schedules (D395), each once a store day.
    reportEmails: () => sendScheduledReports(),
    // The official legal texts the AI's legal pages rest on (D311): a few due reads, each source a week after its last good read.
    legalSources: () => readDueLegalSources(),
    // Legal pages the AI keeps (D311): stores with it on compared with their facts and the law daily, a write queued for each page that needs one.
    legalUpkeep: () => runLegalUpkeep(),
    // Legal pages the AI is writing (D311): what a press's own run did not finish and the upkeep's writes, a language at a time.
    legalWrites: () => runLegalWrites({}, 120_000),
    // Pages, articles, headers and footers to be published or put back, and themes to go live or back (D341, D340): what is due, in
    // the name of who scheduled it.
    schedules: () => runSchedules(),
    // The status page's checks (D360): each part measured, admins emailed once when one fails twice in a row.
    status: () => runStatusChecks(),
    // A rotation of the settings key (PSI SEC-06): while a previous key is set, a batch of secrets written again under the current one.
    secretRotation: () => reencryptSecrets(),
    // The AI manager's calls nobody answered in seven days (PSI AGT-03): ended, never run.
    assistantApprovals: async () => (await expireAssistantApprovals()).length,
    // A VAT rate that begins or ends at a country's midnight (D379): the catalogue's cached labels refreshed then, not at the daily job's hour.
    vatLabels: () => refreshVatLabelsAtMidnight(),
  });
  for (const storeId of r.schedules?.stores ?? []) revalidateTag(pagesTag(storeId), "max");
  if ((r.status?.measured ?? 0) > 0) revalidateTag(STATUS_TAG, "max");
  for (const store of r.schedules?.themeStores ?? []) for (const tag of designTags(store)) revalidateTag(tag, "max");
  // Installed themes that follow updates and are behind their theme's latest version (D245); the stores' pages then show it.
  const themeUpdates = (await tracked("dispatcher.theme-updates", EVERY, () => runThemeUpdates())) ?? { updated: 0, refused: 0, stores: [] };
  for (const store of themeUpdates.stores) for (const tag of designTags(store)) revalidateTag(tag, "max");
  // Kaizena Flow's own installed themes that follow updates (D253); its site shows the new look when the live one moved.
  const platformThemeUpdates = (await tracked("dispatcher.platform-theme-updates", EVERY, () => runPlatformThemeUpdates())) ?? { updated: 0, refused: 0, live: false };
  if (platformThemeUpdates.updated > 0) for (const tag of [PLATFORM_NAVIGATION_TAG, PAGES_TAG, DESIGNS_TAG]) revalidateTag(tag, "max");
  // Premium themes due to be paid (D286): invoiced through Kaizena Flow's billing, a few a run; a try that failed waits.
  const themePurchases = await tracked("dispatcher.theme-purchases", EVERY, () => chargeDueThemePurchases());
  // Domains (D315): purchases invoiced, paid ones registered and followed until done (connecting the store), failed ones refunded.
  const domainPurchases = (await tracked("dispatcher.domain-purchases", EVERY, () => chargeDomainPurchases())) ?? { invoiced: 0, failed: 0 };
  const domainRegistrations = (await tracked("dispatcher.domain-registrations", EVERY, () => registerPaidDomains())) ?? { done: 0, failed: 0 };
  for (const owner of r.altTexts?.owners ?? []) {
    revalidateTag(pagesTag(owner.storeId), "max");
    if (owner.storeId) revalidateTag(catalogTag(owner.storeId), "max");
  }
  const { altTexts, schedules, ...rest } = r;
  return Response.json(
    {
      ...rest,
      altTexts: altTexts?.written ?? null,
      schedules: schedules ? { published: schedules.published, failed: schedules.failed } : null,
      themeUpdates: { updated: themeUpdates.updated, refused: themeUpdates.refused },
      platformThemeUpdates: { updated: platformThemeUpdates.updated, refused: platformThemeUpdates.refused },
      themePurchases,
      domainPurchases,
      domainRegistrations,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = run;
export const POST = run;
