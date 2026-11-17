import "server-only";

import { runEbayJobs } from "@/server/ebay";
import { runSms } from "@/server/sms";
import { runSupplierOrders } from "@/server/supplier-orders";
import { markAiPictures } from "@/server/ai-picture-marks";
import { refreshAltTexts } from "@/server/alt-texts";
import { runAffiliateJobs } from "@/server/affiliate-emails";
import { runBonusJobs } from "@/server/bonus";
import { syncDueFeeds } from "@/server/calendar-sync";
import { sendDueCartReminders } from "@/server/cart-reminders";
import { trimFontFiles } from "@/server/font-trim";
import { endIdleConversations } from "@/server/support";
import { endIdleGuideConversations } from "@/server/docs-guide-store";
import { expireActions } from "@/server/support-actions";
import { summarisePending } from "@/server/support-summary";
import { reencryptSecrets } from "@/server/secret-rotation";
import { expireAssistantApprovals } from "@/server/owner-assistant";
import { refreshInstagramFeeds } from "@/server/instagram";
import { expireDrafts } from "@/server/draft-orders";
import { expireApprovals } from "@/server/company-approvals";
import { archiveFinishedOrders } from "@/server/order-archive";
import { expireOrderEdits } from "@/server/order-edits";
import { runDataJobs } from "@/server/data-jobs";
import { runDueMoves } from "@/server/shopify-move";
import { refreshEmbeddings } from "@/server/embeddings";
import { runExperimentJobs } from "@/server/experiment-jobs";
import { runFollowUps } from "@/server/follow-up-runner";
import { runKaizenLifeHandoffs } from "@/server/kaizen-life-handoffs";
import { measureAutopilotEffects } from "@/server/autopilot-effects";
import { sendAutopilotReports } from "@/server/autopilot-reports";
import { sendScheduledReports } from "@/server/report-schedules";
import { invoiceJobs } from "@/server/invoice-issue";
import { readDueLegalSources } from "@/server/legal-sources";
import { runLegalUpkeep, runLegalWrites } from "@/server/legal-writer";
import { runPaymentJobs } from "@/server/payment-disputes";
import { keepStripeWebhooksCurrent } from "@/server/stripe-endpoints";
import { runLiveDrills } from "@/server/live-drills";
import { settleTrials } from "@/server/store-trial";
import { sandboxJob } from "@/server/sandbox";
import { runReturnJobs } from "@/server/return-jobs";
import { refreshKnowledge } from "@/server/knowledge";
import { crawlWidgetSites } from "@/server/site-crawl";
import { refreshDocsIndex } from "@/server/docs-search";
import { refreshMediaEmbeddings } from "@/server/media-library";
import { runSchedules } from "@/server/page-schedules";
import { refreshVatLabelsAtMidnight } from "@/server/vat-admin";
import { runStatusChecks } from "@/server/status";
import { watchDomains } from "@/server/domain-watch";
import { payHostCommissions } from "@/server/host-payments";
import { sealRecordings } from "@/server/recordings";
import { runContentModeration } from "@/server/content-moderation";
import { sendDuePlanReminders } from "@/server/plan-reminders";
import { sendDueBookingReminders } from "@/server/shopper-emails";
import { sendLowStockNotices } from "@/server/stock-alerts";
import { pollTracking } from "@/server/shipment-tracking";
import { sendAnalyticsAlertEmails, sendDueSummaries } from "@/server/staff-alerts";
import { prepareDueDeliveries } from "@/server/standing-orders";
import { runStoreCopies } from "@/server/store-copy";
import { prepareDueRecurringWork } from "@/server/work-recurring";
import { syncDueTripletex } from "@/server/tripletex-sync";
import { syncDueFiken } from "@/server/fiken-sync";
import { syncAgentPurchases } from "@/server/agent-purchases";
import { runActivityPushes } from "@/server/activities";
import { runBusinessChanges } from "@/server/business-change";
import { runPipedriveMoves } from "@/server/pipedrive";
import { runLedgerPosting } from "@/server/ledger";
import { runPlatformBooks } from "@/server/platform-books";
import { sendPlatformBriefing } from "@/server/platform-briefing";
import { runEinvoiceSending } from "@/server/einvoice-sending";
import { sendAutopilotBudgetAlerts } from "@/server/autopilot-settings";
import { watchAutopilotChanges } from "@/server/autopilot-watch";
import { decideAutopilotTests } from "@/server/autopilot-test-decider";
import { watchChallengeVersions } from "@/server/challenge-pin";
import { sendChallengeStallAlerts } from "@/server/challenge-watch";
import { syncAllAdSpend } from "@/server/ad-accounts";
import { runNightlyUiTranslations } from "@/server/ui-nightly";
import { syncHouseCustomers } from "@/server/house-customers";

/**
 * The dispatcher's jobs (`/api/cron/cart-reminders`, every five minutes), in the order they run, each kept in `commerce.cron_jobs` as
 * `dispatcher.{name}` in kebab case: the key is the job's row, so never rename one. They live here, not in the route, so a test can run
 * each one (bloat review step 1.10, `src/server/query-budget.int.test.ts`).
 */
export const DISPATCHER_JOBS = {
  carts: () => sendDueCartReminders(),
  plans: () => sendDuePlanReminders(),
  bookings: () => sendDueBookingReminders(),
  calendars: () => syncDueFeeds(),
  commissions: () => payHostCommissions(),
  // An AI reads the notices still waiting and checks new and changed listings (D411 part 2); a person decides every one.
  contentModeration: () => runContentModeration(),
  // AI pictures made before their files were marked get IPTC's digital source type in their XMP (AI Act Art. 50(2)), ten a run.
  aiPictureMarks: () => markAiPictures(),
  // Hourly inside (the first five minutes of the hour); the other runs return at once.
  embeddings: () => refreshEmbeddings(),
  knowledge: () => refreshKnowledge(),
  // Chat widgets' websites (D583): a few due sites listed, then a few dozen due pages read into the knowledge base, within two minutes.
  widgetSites: () => crawlWidgetSites(),
  // The docs' search index (D443): rewritten when this deployment's articles or contracts differ from the fingerprint stored, then rows
  // given vectors by the platform's AI where it has an embedding model; reads older than 90 days and misses unseen for 180 forgotten (the counts are pruned by the daily run).
  docsIndex: () => refreshDocsIndex(),
  // Kaizena Flow's own customers (D467): its owners and applicants kept as customers of its own store, with their tags and sign-up deals.
  houseCustomers: () => syncHouseCustomers(),
  media: () => refreshMediaEmbeddings(),
  altTexts: () => refreshAltTexts(),
  deliveries: () => prepareDueDeliveries(),
  recurring: () => prepareDueRecurringWork(),
  // Tripletex (D453): the issued invoices and credit notes of stores whose connection is on, booked as vouchers, within 40 seconds.
  tripletex: () => syncDueTripletex(),
  // E-invoices (B1, D463): documents issued to businesses in the last two days looked at once, the buyer asked of the Peppol network, and
  // those it receives handed to the access point when one is connected (none yet: they are marked waiting and went by email).
  einvoices: () => runEinvoiceSending(),
  activities: () => runActivityPushes(),
  // A change of the business behind a store (D473) taking effect on its day, and the store drawn again with its new details.
  businessChanges: () => runBusinessChanges(),
  // Moving in from Pipedrive (D477): a check or an import the owner left goes on, page by page, within 40 seconds.
  pipedrive: () => runPipedriveMoves(),
  // Our own ledger (D478): the documents each store issued since its books opened, posted once, within 40 seconds.
  ledger: () => runLedgerPosting(),
  // Kaizena Flow's own money (D508): its live sales, credit notes and Stripe payouts posted into the books the platform names, within 30 seconds.
  platformBooks: () => runPlatformBooks(),
  // The platform's morning briefing (D513): at seven in Oslo, daily or on Mondays, once a period, to its owners and finance.
  platformBriefing: () => sendPlatformBriefing(),
  // Fiken (D460): the same for stores whose Fiken connection is on, booked as sales (Annet salg), within 40 seconds.
  fiken: () => syncDueFiken(),
  // The AI's single-use cards (D599): each open card's charges read, and the card closed once charged or out of time.
  agentPurchases: () => syncAgentPurchases(),
  storeCopies: () => runStoreCopies(),
  bonus: () => runBonusJobs(),
  affiliates: () => runAffiliateJobs(),
  // Instagram feeds (D560, never throws): tokens refreshed before their 60 days run out, and each account's posts read again hourly.
  instagram: () => refreshInstagramFeeds(),
  experiments: () => runExperimentJobs(),
  returns: () => runReturnJobs(),
  invoices: () => invoiceJobs(),
  // A Shopify move due now starts, a running one goes on (D445 step 7a); before the imports it hands work to.
  shopMoves: () => runDueMoves(),
  dataJobs: () => runDataJobs(),
  lowStock: () => sendLowStockNotices(),
  // Drop shipping (D551): supplier orders made for paid orders' supplier lines, and those whose wait is over emailed to their suppliers.
  supplierOrders: () => runSupplierOrders(),
  // eBay as a sales channel (D555): each connected store's new eBay orders fetched (drawing its stock) and its listings sent, ten stores a run.
  ebay: () => runEbayJobs(),
  // SMS marketing (D565): checkout consents whose order was paid become subscriptions, and texts whose recipient's hours have come are sent.
  sms: () => runSms({ deadline: Date.now() + 120_000 }),
  draftExpiry: () => expireDrafts(),
  // Company orders (D321 C.2) that waited for approval, or for payment after it, longer than the window: cancelled, their stock let go.
  approvalExpiry: () => expireApprovals(),
  autoArchive: () => archiveFinishedOrders(),
  // Order changes whose pay link ran out (D174): sessions closed first, a change paid in the last minute applied, the held units released.
  editExpiry: () => expireOrderEdits(),
  // Support (D216): conversations with the AI that nobody has written in for the desk's time end, so their period begins.
  supportIdle: () => endIdleConversations(),
  // The docs guide (D444): its conversations end as the platform chat's do, after Kaizena Flow's desk's time without a message.
  docsGuideIdle: () => endIdleGuideConversations(),
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
  // Free trials' ends (D420): an open store whose trial ended with no plan made private, and made public again once a plan starts.
  trials: () => settleTrials(),
  // The page builder's sandboxes (D457) past their time ended (the pass stops working and the store is closed), and what was in ended
  // ones deleted, their stores left as bare tombstones.
  sandboxes: () => sandboxJob(),
  // Self-hosted fonts (D59): files not yet looked at cut to the weights their families are installed in, under the same name.
  fonts: () => trimFontFiles(),
  // The AI manager's follow-ups (PSI AGT-04): a few due ones given back to it, in the asker's name, and the asker emailed.
  followUps: () => runFollowUps(),
  // Tasks the assistants hand each other (docs/assistants-together.md): one from Kaizen Life whose run never started run, Kaizen Life told
  // what it has not heard, and a task it never reported on given up.
  lifeHandoffs: () => runKaizenLifeHandoffs(),
  // The autopilot's daily digests and weekly reports (D309), to the people whose plans ran lately.
  autopilotReports: () => sendAutopilotReports(),
  // What the autopilot's changes moved (D418): once an hour, a few changes made two weeks or more ago measured on the figure each was meant to move.
  autopilotEffects: () => measureAutopilotEffects(),
  // Watch and roll back (docs/100-day-challenge.md F4): the autopilot's recent changes judged hourly, a clear fall undone.
  autopilotWatch: () => watchAutopilotChanges(),
  // The autopilot's tests of its own page changes (E4.1, D729): decided hourly by their verdicts, the change live only when it does better.
  autopilotTests: () => decideAutopilotTests(),
  // The autopilot's own AI budget (PSI AST-07): owners told once a month when it nears 80 % and again when it is spent.
  autopilotBudgets: () => sendAutopilotBudgetAlerts(),
  // The 100-day challenge's stall watch (docs/100-day-challenge.md A6): what holds a challenge store up, to the platform team at once.
  challengeStalls: () => sendChallengeStallAlerts(),
  // What each challenge store's AI runs on, against what was seen last: a change after a deploy is logged on the challenge (F5).
  challengeVersions: () => watchChallengeVersions(),
  // The Meta ad accounts' daily spend into the books (docs/100-day-challenge.md D2), each account every six hours.
  adSpend: () => syncAllAdSpend(),
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
  // The domain watch (E4.2): a few active domains not asked for a day asked whether they still serve their store, and when one registered
  // elsewhere expires, for the Domains page's health and the domain alert.
  domainWatch: () => watchDomains(),
  // A rotation of the settings key (PSI SEC-06): while a previous key is set, a batch of secrets written again under the current one.
  secretRotation: () => reencryptSecrets(),
  // The AI manager's calls nobody answered in seven days (PSI AGT-03): ended, never run.
  assistantApprovals: async () => (await expireAssistantApprovals()).length,
  // A VAT rate that begins or ends at a country's midnight (D379): the catalogue's cached labels refreshed then, not at the daily job's hour.
  vatLabels: () => refreshVatLabelsAtMidnight(),
  // Interface text added since (D436): once a night from 02:00 Oslo time, the texts the translated languages lack, by the platform's AI,
  // at most 300 a language; the day is claimed and the run kept as `daily.ui-translations`.
  uiTranslations: () => runNightlyUiTranslations(),
  // Merges a finished recording's segments into one file: each Storage object is a Postgres row (D656).
  sealRecordings: () => sealRecordings({ deadline: Date.now() + 60_000 }),
} satisfies Record<string, () => Promise<unknown>>;
