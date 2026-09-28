import { revalidateTag } from "next/cache";
import { connection } from "next/server";

import { refreshAltTexts } from "@/server/alt-texts";
import { syncDueFeeds } from "@/server/calendar-sync";
import { sendDueCartReminders } from "@/server/cart-reminders";
import { catalogTag } from "@/server/catalog";
import { pruneChatUsage } from "@/server/chat-agent";
import { cronAuthorised } from "@/server/cron-auth";
import { refreshEmbeddings } from "@/server/embeddings";
import { pruneFormSubmissions } from "@/server/forms";
import { pruneSearchCache } from "@/server/search-cache";
import { refreshKnowledge } from "@/server/knowledge";
import { refreshMediaEmbeddings } from "@/server/media-library";
import { pagesTag } from "@/server/pages";
import { payHostCommissions } from "@/server/host-payments";
import { pruneSearchLog } from "@/server/search";
import { sendDuePlanReminders } from "@/server/plan-reminders";
import { sendDueBookingReminders } from "@/server/shopper-emails";

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
 * show them.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const [carts, plans, bookings, calendars, commissions, searches, embeddings, cache, knowledge, chat, media, altTexts, forms] = await Promise.all([
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
  ]);
  for (const owner of altTexts.owners) {
    revalidateTag(pagesTag(owner.storeId), "max");
    if (owner.storeId) revalidateTag(catalogTag(owner.storeId), "max");
  }
  return Response.json(
    { carts, plans, bookings, calendars, commissions, searches, embeddings, cache, knowledge, chat, media, altTexts: altTexts.written, forms },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = run;
export const POST = run;
