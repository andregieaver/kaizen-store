import "server-only";

import { storesOf } from "@/components/admin/admin-shell-parts";
import { LIST_PAGE_SIZE, listOffset } from "@/lib/list-page";
import type { OrderListInput } from "@/lib/order-list";
import type { Membership } from "@/server/auth";
import { controlCenter } from "@/server/control-center";
import { cronJobRows } from "@/server/cron-runs";
import { listJobs } from "@/server/data-jobs";
import { demoContent } from "@/server/demo-content";
import { orderPreviews } from "@/server/home";
import { listOrdersPage, resolveOrderList } from "@/server/order-list";
import { tagSuggestions } from "@/server/order-tags";
import { listOrderViews } from "@/server/order-views";
import { memberCan } from "@/server/permissions";
import { countPendingRequests } from "@/server/platform";
import { platformBriefingSetting, platformSnapshot } from "@/server/platform-briefing";
import { platformOverview } from "@/server/platform-overview";
import { adminProductCounts, adminProductPage, type ProductShow } from "@/server/product-list";
import { getSetupProgress } from "@/server/setup";
import { starterOfStore } from "@/server/store-starters";
import { pausedAfter } from "@/server/store-trial";
import type { Store } from "@/server/stores";
import { failedWebhookEvents } from "@/server/stripe-webhooks";
import { waitingCount } from "@/server/support";
import { openRequestCount } from "@/server/support-actions";
import { kaizenDesk, memberDesk, type Desk } from "@/server/support-desk";
import { listTerms } from "@/server/taxonomy";
import { countProductsNeedingMeasure, productsNeedingMeasure } from "@/server/unit-price-gaps";

/**
 * One function per admin screen: the reads it runs after the member is known, in the same order, the same Promise.all groups and under
 * the same conditions (bloat review step 1.9). `src/server/admin-statements.int.test.ts` counts them, and the screens call these, so the
 * count is what they run; never keep a mirror copy.
 */

/** What waits for the store's people in Support: conversations waiting for a person and the requests the chat assistant passed on. */
async function supportWaiting(desk: Desk): Promise<number> {
  const [conversations, requests] = await Promise.all([waitingCount([desk]), openRequestCount(desk)]);
  return conversations + requests;
}

/** The store shell (`[store]/layout.tsx`): the member's stores, what waits in Support, the starter and the trial's end. */
export async function storeShellReads(member: Membership) {
  const { account, store } = member;
  const open = store.status === "active";
  const stores = await storesOf(account);
  // Support (D216): the conversations waiting for a person, and the requests the chat assistant passed to the team (ecosystem plan E1.7),
  // on the Support tab of those who may read it.
  const waiting = memberCan(member, "support:read") ? await supportWaiting(memberDesk(member).desk) : 0;
  // A starter store says what it is (D175): starting content, or a live demo store (D277) with its own page for platform admins.
  const starter = store.starter ? await starterOfStore(store.id) : null;
  // A store whose free trial or plan ended with no plan running was made private again (D420): its members are told why, and how to open it.
  const trialPaused = open ? await pausedAfter(store.id) : null;
  return { stores, waiting, starter, trialPaused };
}

/** The store Home (`[store]/page.tsx`). */
export async function storeHomeReads(member: Membership) {
  const { account, store } = member;
  const owner = memberCan(member, "owner");
  const [progress, center, demo] = await Promise.all([
    getSetupProgress(store),
    controlCenter(account, store.slug),
    // What the store template brought and the owner has not changed (`docs/theme-showcase-phase-1.md` step 4b): theirs to remove.
    owner ? demoContent(store.id, store.localization.locales[0] ?? "en") : null,
  ]);
  return { progress, center, demo };
}

/** The orders list (`[store]/orders/page.tsx`, its body): the address resolved, then the page, the saved views and the tag suggestions, then each order's lines. */
export async function ordersListReads(store: Store, input: OrderListInput) {
  const resolved = await resolveOrderList(store.id, input);
  const [page, views, suggestions] = await Promise.all([
    listOrdersPage(store.id, resolved.params, resolved.context),
    listOrderViews(store.id),
    tagSuggestions(store.id),
  ]);
  // Round 2 (D597): a picture of what is in each order on the page.
  const previews = await orderPreviews(store.id, page.rows.map((r) => r.id));
  return { resolved, page, views, suggestions, previews };
}

/** The products list (`[store]/products/page.tsx`, its list). */
export async function productsListReads(
  member: Membership,
  o: { show: ProductShow; q: string; page: number; needsFilter: boolean; canWrite: boolean; locale: string },
) {
  const { store } = member;
  const { show, q, page, needsFilter, canWrite, locale } = o;
  const archived = show === "archived";
  // Unit price (D160): active products that need a content and have none, for the notice and its filter.
  // A hundred a page with the count of all the view and search find, and each view's figure (code review 1.13, D834).
  const [list, counts, needingCount, needing, terms, imports] = await Promise.all([
    needsFilter ? Promise.resolve({ rows: [], total: 0 }) : adminProductPage(store, { show, q, limit: LIST_PAGE_SIZE, offset: listOffset(page) }),
    needsFilter || archived ? Promise.resolve(null) : adminProductCounts(store.id),
    // The notice needs the number; the list itself is read only on its own filter.
    archived || needsFilter ? Promise.resolve(0) : countProductsNeedingMeasure(store.id),
    needsFilter ? productsNeedingMeasure(store.id, store.localization.locales[0] ?? locale) : Promise.resolve([]),
    // Bulk editing (D165): the store's categories and tags for the action panels (the markets come from the store), read only for a member who can change products.
    canWrite && !needsFilter ? listTerms({ storeId: store.id, contentType: "product" }) : Promise.resolve(null),
    canWrite && !archived && !needsFilter ? listJobs(member, "product_import", 5) : Promise.resolve([]),
  ]);
  return { products: list.rows, total: list.total, counts, needingCount, needing, terms, imports };
}

/** The platform's shell (`platform/layout.tsx`): Kaizena Flow's desk, then the requests, the conversations and the requests passed on. */
export async function platformShellReads() {
  const { desk } = await kaizenDesk();
  // Support: owners waiting for a person and the requests Kaizena Flow's chat assistant passed on (ecosystem plan E1.7), as a store counts them.
  const [waiting, supportWaiting, supportRequests] = await Promise.all([countPendingRequests(), waitingCount([desk]), openRequestCount(desk)]);
  return { waiting, supportWaiting, supportRequests };
}

/** The platform Home (`platform/page.tsx`), first group. */
export async function platformHomeReads() {
  const [o, jobs, snapshot, briefing, failedEvents] = await Promise.all([
    platformOverview(),
    cronJobRows(),
    // With what Kaizena Flow's own site raises (ecosystem plan E5.2, D757): its store's heat, speed and domains, and kaizenaflow.com.
    platformSnapshot(new Date(), { house: true }),
    platformBriefingSetting(),
    failedWebhookEvents(),
  ]);
  return { o, jobs, snapshot, briefing, failedEvents };
}
