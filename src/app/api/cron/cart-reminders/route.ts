import { revalidateTag } from "next/cache";
import { connection } from "next/server";
import { catalogTag } from "@/server/catalog";
import { cronAuthorised } from "@/server/cron-auth";
import { runJobs, tracked } from "@/server/cron-runs";
import { DISPATCHER_JOBS } from "@/server/dispatcher-jobs";
import { PAGES_TAG, pagesTag } from "@/lib/cache-tags";
import { STATUS_TAG } from "@/server/status";
import { DESIGNS_TAG, designTags, runPlatformThemeUpdates, runThemeUpdates } from "@/server/design-presets";
import { chargeDomainPurchases, registerPaidDomains } from "@/server/domain-purchases";
import { chargeDueThemePurchases } from "@/server/theme-prices";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";
import { pruneApiIdempotency } from "@/server/api-idempotency";
import { pruneOAuthTokens } from "@/server/oauth";

/** Room for the slower jobs (a store copy, the embeddings) before Vercel stops the run (PSI 2026-10-24, REL-06). */
export const maxDuration = 300;

/** Supabase's scheduler runs this every five minutes. */
const EVERY = 300;

/**
 * Every five minutes, from Supabase's scheduler: the stores' cart reminders
 * and Kaizen's plan reminders that are due (D33), reminders before
 * appointments (D65), other calendars read in for rooms and items (D67),
 * stores' commissions on hosts' bookings not yet sent (D71),
 * products' vectors for search by meaning brought up to date (D74), and
 * the chat agents' knowledge cut anew from pages published since, with its
 * vectors; media
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
 * customers whose friends' orders earned them credits are told, once per order; and A/B tests' upkeep (D148, never throws): tests past their end stopped, guardrails looked at, old
 * carts' visitors forgotten;; and withdrawals and returns (D153, never throws): a reminder to the store, once per return, when a refund is past its legal deadline, and the acknowledgement of a confirmed withdrawal tried again when the first email never got out; and invoices and credit notes (D159, never throws): refunds Stripe left pending asked of Stripe, invoices that waited for the seller's details issued, credit notes that waited for their invoice issued, and the stand-alone email for a document issued later than its payment or refund (no Chromium here: the PDFs are `/api/cron/document-pdfs`); and imports and exports (wave 2, D165, never throws): jobs nobody holds taken up where their cursor is (a dry run, an apply, an export), a few at a time within the time; and drop shipping's supplier orders (D551, never throws for one order): made for paid orders whose units were drawn at a supplier's location, then emailed to the supplier once the store's wait is over, a cancelled order's cancelled instead; and the low-stock notices (wave 3, D172, never throws): one email per store to its owners listing the variants that crossed the warning level they set since the last run (the history of stock is pruned daily, `runRetention()`); and the orders' upkeep (wave 3, D173, never throws): draft orders whose pay link ran out expired (their Stripe sessions closed first, an order paid in the last minute left alone, the unpaid order cancelled and its stock given back, its number kept so the sequence has no gap), and, for the open stores whose owner chose it, finished orders archived (up to 200 a store a run); and support (D216, never throws): conversations with the AI that went quiet for the desk's time ended; and notifications (wave 3, D238, never throw): tracked parcels' carriers asked (at most 60 parcels a run, 4 calls at once, 4 s each), their events kept, the out-for-delivery and delivered emails sent where switched on and a verified delivery recorded, and the staff summaries due at their hour sent; and installed themes that follow updates brought to their theme's latest version, a few a run (D245, never throws); and premium themes due to be paid invoiced through Kaizena Flow's billing (D286, never throws); and payments (D288, never throws): the method and risk of captured Stripe payments the reply did not read, and staff told once when a dispute's evidence is due within three days; and pages and articles scheduled to be published (D341, never throws), their drafts published in the name of who scheduled them while they still may; and the catalogue's VAT labels refreshed in the first minutes of a country's day when a rate begins or ends (D379, never throws); and, once a night, the interface text the machine-translated languages lack translated by the platform's AI as drafts to review (D436, at most 300 texts a language); and the docs' search index rewritten after a deploy that changed the docs or the contracts, with its vectors (D443); and the issued invoices and credit notes of stores connected to Tripletex booked there as vouchers, each once (D453, never throws); and the invoices and credit notes issued to businesses sent as e-invoices where the buyer receives them on the Peppol network (D463); and the person a call, meeting or task is for told on their devices when it is due, once (D468); and a change of the business behind a store taking effect on its day, the store then drawn again (D473); and the page builder's sandboxes past their time ended and what was in them deleted (D457); and self-hosted fonts' files cut to the weights their families are installed in, each once (D59, twenty a run); and Kaizena Flow's own owners and applicants kept as customers of its own store, with their tags and sign-up deals (D467); and connected Instagram accounts' tokens refreshed and their posts read again hourly (D560); and the tasks the assistants hand each other over the account link (docs/assistants-together.md): a task from Kaizen Life whose run never started run, Kaizen Life told what it has not heard, and a task handed to it that it never reported on given up. Old searches, search answers, form sends, chat counts, recommendation events, docs counts and page copies are pruned by the daily run (/api/cron/subscription-reminders), and the Admin API's kept answers and the authorization server's tokens here once an hour.
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
  const r = await runJobs("dispatcher", EVERY, DISPATCHER_JOBS);
  // Kept 24 hours, so pruned once an hour (the first five minutes of the hour), not every run (bloat review step 0.31).
  const hourly = new Date().getUTCMinutes() < 5;
  const apiIdempotency = hourly ? await tracked("hourly.api-idempotency", 3600, () => pruneApiIdempotency()) : null;
  const oauthTokens = hourly ? await tracked("hourly.oauth-tokens", 3600, () => pruneOAuthTokens()) : null;
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
  // Products given the words their page shows of their standard category (bloat review step 2.23): their stores' catalogues show them.
  for (const storeId of r.standardShown?.storeIds ?? []) revalidateTag(catalogTag(storeId), "max");
  const { altTexts, schedules, standardShown, ...rest } = r;
  return Response.json(
    {
      ...rest,
      apiIdempotency,
      oauthTokens,
      altTexts: altTexts?.written ?? null,
      standardShown: standardShown?.written ?? null,
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
