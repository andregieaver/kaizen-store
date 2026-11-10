"use client";

import type { AdminAreaMessages, ClientArea } from "@/lib/admin-text";

/**
 * The English of every area a client part may read but `common` and `signIn` (PSI PERF-01, code review FS1): fetched only when a part
 * reads an area that nothing handed down, a chunk of its own per area, and waited for (`use()`). Until 10 November 2026 every area's
 * English rode in every admin screen's first scripts, about 1 MB, for a fallback that the pages' own hand-downs (`AdminAreas`,
 * `AdminTextScope`, the layouts' `setup` and `shell`) make rare.
 *
 * A part that waits is not interactive until its area arrives, and an early press could then submit a form without its script (what
 * backed the first try out, 31 October 2026). So a fallback is kept as a fault to fix: each one is noted on the page
 * (`window.__adminTextFallbacks`), and `e2e/signed-in/admin-text-fallbacks.spec.ts` visits the admin's screens and fails on any. The fix
 * is to hand the area down where the page is drawn, never to put the English back.
 */
export type LaterArea = Exclude<ClientArea, "common" | "signIn">;
const LATER: { [A in LaterArea]: () => Promise<AdminAreaMessages[A]> } = {
  domains: () => import("@/lib/admin-messages/domains.en").then((m) => m.domainsEn),
  home: () => import("@/lib/admin-messages/home.en").then((m) => m.homeEn),
  customers: () => import("@/lib/admin-messages/customers.en").then((m) => m.customersEn),
  privacy: () => import("@/lib/admin-messages/privacy.en").then((m) => m.privacyEn),
  marketing: () => import("@/lib/admin-messages/marketing.en").then((m) => m.marketingEn),
  discounts: () => import("@/lib/admin-messages/discounts.en").then((m) => m.discountsEn),
  loyalty: () => import("@/lib/admin-messages/loyalty.en").then((m) => m.loyaltyEn),
  platform: () => import("@/lib/admin-messages/platform.en").then((m) => m.platformEn),
  platformSite: () => import("@/lib/admin-messages/platform-site.en").then((m) => m.platformSiteEn),
  platformTools: () => import("@/lib/admin-messages/platform-tools.en").then((m) => m.platformToolsEn),
  bookings: () => import("@/lib/admin-messages/bookings.en").then((m) => m.bookingsEn),
  support: () => import("@/lib/admin-messages/support.en").then((m) => m.supportEn),
  work: () => import("@/lib/admin-messages/work.en").then((m) => m.workEn),
  assistant: () => import("@/lib/admin-messages/assistant.en").then((m) => m.assistantEn),
  staffEmails: () => import("@/lib/admin-messages/staff-emails.en").then((m) => m.staffEmailsEn),
  analytics: () => import("@/lib/admin-messages/analytics.en").then((m) => m.analyticsEn),
  finance: () => import("@/lib/admin-messages/finance.en").then((m) => m.financeEn),
  taxReports: () => import("@/lib/admin-messages/tax-reports.en").then((m) => m.taxReportsEn),
  reports: () => import("@/lib/admin-messages/reports.en").then((m) => m.reportsEn),
  customReports: () => import("@/lib/admin-messages/custom-reports.en").then((m) => m.customReportsEn),
  settings: () => import("@/lib/admin-messages/settings.en").then((m) => m.settingsEn),
  tax: () => import("@/lib/admin-messages/tax.en").then((m) => m.taxEn),
  payments: () => import("@/lib/admin-messages/payments.en").then((m) => m.paymentsEn),
  shipping: () => import("@/lib/admin-messages/shipping.en").then((m) => m.shippingEn),
  notifications: () => import("@/lib/admin-messages/notifications.en").then((m) => m.notificationsEn),
  legal: () => import("@/lib/admin-messages/legal.en").then((m) => m.legalEn),
  staff: () => import("@/lib/admin-messages/staff.en").then((m) => m.staffEn),
  billing: () => import("@/lib/admin-messages/billing.en").then((m) => m.billingEn),
  builder: () => import("@/lib/admin-messages/builder.en").then((m) => m.builderEn),
  blocks: () => import("@/lib/admin-messages/blocks.en").then((m) => m.blocksEn),
  website: () => import("@/lib/admin-messages/website.en").then((m) => m.websiteEn),
  design: () => import("@/lib/admin-messages/design.en").then((m) => m.designEn),
  redirects: () => import("@/lib/admin-messages/redirects.en").then((m) => m.redirectsEn),
  experiments: () => import("@/lib/admin-messages/experiments.en").then((m) => m.experimentsEn),
  products: () => import("@/lib/admin-messages/products.en").then((m) => m.productsEn),
  product: () => import("@/lib/admin-messages/product.en").then((m) => m.productEn),
  inventory: () => import("@/lib/admin-messages/inventory.en").then((m) => m.inventoryEn),
  giftCards: () => import("@/lib/admin-messages/gift-cards.en").then((m) => m.giftCardsEn),
  reviews: () => import("@/lib/admin-messages/reviews.en").then((m) => m.reviewsEn),
  fields: () => import("@/lib/admin-messages/fields.en").then((m) => m.fieldsEn),
  orders: () => import("@/lib/admin-messages/orders.en").then((m) => m.ordersEn),
  order: () => import("@/lib/admin-messages/order.en").then((m) => m.orderEn),
  drafts: () => import("@/lib/admin-messages/drafts.en").then((m) => m.draftsEn),
  returns: () => import("@/lib/admin-messages/returns.en").then((m) => m.returnsEn),
  invoices: () => import("@/lib/admin-messages/invoices.en").then((m) => m.invoicesEn),
  platformLegal: () => import("@/lib/admin-messages/platform-legal.en").then((m) => m.platformLegalEn),
  capacity: () => import("@/lib/admin-messages/capacity.en").then((m) => m.capacityEn),
  content: () => import("@/lib/admin-messages/content.en").then((m) => m.contentEn),
  blog: () => import("@/lib/admin-messages/blog.en").then((m) => m.blogEn),
  schedules: () => import("@/lib/admin-messages/schedules.en").then((m) => m.schedulesEn),
  oauth: () => import("@/lib/admin-messages/oauth.en").then((m) => m.oauthEn),
  setup: () => import("@/lib/admin-messages/setup.en").then((m) => m.setupEn),
  shell: () => import("@/lib/admin-messages/shell.en").then((m) => m.shellEn),
  moving: () => import("@/lib/admin-messages/moving.en").then((m) => m.movingEn),
};

/** A fetch React can read with `use()`; one that is already settled (`settledEnglish()`) is read at once. */
type Thenable<T> = Promise<T> & { status?: "pending" | "fulfilled" | "rejected"; value?: T };
const fetched = new Map<LaterArea, Thenable<unknown>>();

export function englishLater<A extends LaterArea>(area: A): Promise<AdminAreaMessages[A]> {
  let found = fetched.get(area);
  if (!found) {
    const loading: Thenable<unknown> = LATER[area]();
    // Marked when it arrives, as React marks what `use()` reads, so a later read is at once.
    loading.then(
      (value) => Object.assign(loading, { status: "fulfilled" as const, value }),
      () => Object.assign(loading, { status: "rejected" as const }),
    );
    found = loading;
    fetched.set(area, found);
  }
  return found as Promise<AdminAreaMessages[A]>;
}

/** An area's English if it has arrived already, read at once (no `use()`, so it works outside a render too); else undefined. */
export function arrivedEnglish<A extends LaterArea>(area: A): AdminAreaMessages[A] | undefined {
  const found = fetched.get(area);
  return found?.status === "fulfilled" ? (found.value as AdminAreaMessages[A]) : undefined;
}

/** Every area that has its English fetched later: the unit tests settle them all first. */
export const LATER_AREAS = Object.keys(LATER) as LaterArea[];

/** An area's English as already fetched, so a part drawn on its own (a unit test's `renderToStaticMarkup()`) reads it at once. */
export function settledEnglish<A extends LaterArea>(area: A, words: AdminAreaMessages[A]): void {
  fetched.set(area, Object.assign(Promise.resolve(words), { status: "fulfilled" as const, value: words }));
}

declare global {
  interface Window {
    /** The areas this page read without having them handed down (see above); read by the signed-in end-to-end tests. */
    __adminTextFallbacks?: string[];
  }
}

/** Notes, in the browser, that a part read an area nothing handed down. Idempotent, so it may run during a render. */
export function noteFallback(area: string): void {
  if (typeof window === "undefined") return;
  const seen = (window.__adminTextFallbacks ??= []);
  if (!seen.includes(area)) seen.push(area);
}
