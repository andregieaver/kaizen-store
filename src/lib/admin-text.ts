import type { AdminLang } from "./admin-lang";
import type { CommonMessages } from "./admin-messages/common.en";
import { COMMON_WORDS } from "./admin-words/common";
import { domainsEn, type DomainsMessages } from "./admin-messages/domains.en";
import { domainsNb } from "./admin-messages/domains.nb";
import { ordersEn, type OrdersMessages } from "./admin-messages/orders.en";
import { ordersNb } from "./admin-messages/orders.nb";
import type { OrderMessages } from "./admin-messages/order.en";
import { ORDER_WORDS } from "./admin-words/order";
import { draftsEn, type DraftsMessages } from "./admin-messages/drafts.en";
import { draftsNb } from "./admin-messages/drafts.nb";
import { returnsEn, type ReturnsMessages } from "./admin-messages/returns.en";
import { returnsNb } from "./admin-messages/returns.nb";
import type { InvoicesMessages } from "./admin-messages/invoices.en";
import { INVOICES_WORDS } from "./admin-words/invoices";
import { productsEn, type ProductsMessages } from "./admin-messages/products.en";
import { productsNb } from "./admin-messages/products.nb";
import { productEn, type ProductMessages } from "./admin-messages/product.en";
import { productNb } from "./admin-messages/product.nb";
import { inventoryEn, type InventoryMessages } from "./admin-messages/inventory.en";
import { inventoryNb } from "./admin-messages/inventory.nb";
import { giftCardsEn, type GiftCardsMessages } from "./admin-messages/gift-cards.en";
import { giftCardsNb } from "./admin-messages/gift-cards.nb";
import { reviewsEn, type ReviewsMessages } from "./admin-messages/reviews.en";
import { reviewsNb } from "./admin-messages/reviews.nb";
import { contentEn, type ContentMessages } from "./admin-messages/content.en";
import { contentNb } from "./admin-messages/content.nb";
import { fieldsEn, type FieldsMessages } from "./admin-messages/fields.en";
import { fieldsNb } from "./admin-messages/fields.nb";
import type { CustomersMessages } from "./admin-messages/customers.en";
import { CUSTOMERS_WORDS } from "./admin-words/customers";
import { privacyEn, type PrivacyMessages } from "./admin-messages/privacy.en";
import { privacyNb } from "./admin-messages/privacy.nb";
import { marketingEn, type MarketingMessages } from "./admin-messages/marketing.en";
import { marketingNb } from "./admin-messages/marketing.nb";
import { discountsEn, type DiscountsMessages } from "./admin-messages/discounts.en";
import { discountsNb } from "./admin-messages/discounts.nb";
import { builderEn, type BuilderMessages } from "./admin-messages/builder.en";
import { builderNb } from "./admin-messages/builder.nb";
import { blocksEn, type BlocksMessages } from "./admin-messages/blocks.en";
import { blocksNb } from "./admin-messages/blocks.nb";
import type { WebsiteMessages } from "./admin-messages/website.en";
import { WEBSITE_WORDS } from "./admin-words/website";
import { designEn, type DesignMessages } from "./admin-messages/design.en";
import { designNb } from "./admin-messages/design.nb";
import { movingEn, type MovingMessages } from "./admin-messages/moving.en";
import { movingNb } from "./admin-messages/moving.nb";
import { redirectsEn, type RedirectsMessages } from "./admin-messages/redirects.en";
import { redirectsNb } from "./admin-messages/redirects.nb";
import type { ExperimentsMessages } from "./admin-messages/experiments.en";
import { EXPERIMENTS_WORDS } from "./admin-words/experiments";
import { settingsEn, type SettingsMessages } from "./admin-messages/settings.en";
import { settingsNb } from "./admin-messages/settings.nb";
import { taxEn, type TaxMessages } from "./admin-messages/tax.en";
import { taxNb } from "./admin-messages/tax.nb";
import { paymentsEn, type PaymentsMessages } from "./admin-messages/payments.en";
import { paymentsNb } from "./admin-messages/payments.nb";
import { shippingEn, type ShippingMessages } from "./admin-messages/shipping.en";
import { shippingNb } from "./admin-messages/shipping.nb";
import { carriersEn, type CarriersMessages } from "./admin-messages/carriers.en";
import { carriersNb } from "./admin-messages/carriers.nb";
import { fikenEn, type FikenMessages } from "./admin-messages/fiken.en";
import { fikenNb } from "./admin-messages/fiken.nb";
import { consoleEn, type ConsoleMessages } from "./admin-messages/console.en";
import { consoleNb } from "./admin-messages/console.nb";
import { businessEn, type BusinessMessages } from "./admin-messages/business.en";
import { businessNb } from "./admin-messages/business.nb";
import type { BooksMessages } from "./admin-messages/books.en";
import { BOOKS_WORDS } from "./admin-words/books";
import { dealsEn, type DealsMessages } from "./admin-messages/deals.en";
import { dealsNb } from "./admin-messages/deals.nb";
import type { ScreensMessages } from "./admin-messages/screens.en";
import { SCREENS_WORDS } from "./admin-words/screens";
import { storePartsEn, type StorePartsMessages } from "./admin-messages/store-parts.en";
import { storePartsNb } from "./admin-messages/store-parts.nb";
import { backdropsEn, type BackdropsMessages } from "./admin-messages/backdrops.en";
import { backdropsNb } from "./admin-messages/backdrops.nb";
import { animationEn, type AnimationMessages } from "./admin-messages/animation.en";
import { animationNb } from "./admin-messages/animation.nb";
import { notificationsEn, type NotificationsMessages } from "./admin-messages/notifications.en";
import { notificationsNb } from "./admin-messages/notifications.nb";
import { legalEn, type LegalMessages } from "./admin-messages/legal.en";
import { legalNb } from "./admin-messages/legal.nb";
import { staffEn, type StaffMessages } from "./admin-messages/staff.en";
import { staffNb } from "./admin-messages/staff.nb";
import { billingEn, type BillingMessages } from "./admin-messages/billing.en";
import { billingNb } from "./admin-messages/billing.nb";
import { analyticsEn, type AnalyticsMessages } from "./admin-messages/analytics.en";
import { analyticsNb } from "./admin-messages/analytics.nb";
import { financeEn, type FinanceMessages } from "./admin-messages/finance.en";
import { financeNb } from "./admin-messages/finance.nb";
import { taxReportsEn, type TaxReportsMessages } from "./admin-messages/tax-reports.en";
import { taxReportsNb } from "./admin-messages/tax-reports.nb";
import type { ReportsMessages } from "./admin-messages/reports.en";
import { REPORTS_WORDS } from "./admin-words/reports";
import type { CustomReportsMessages } from "./admin-messages/custom-reports.en";
import { CUSTOM_REPORTS_WORDS } from "./admin-words/custom-reports";
import type { SupportMessages } from "./admin-messages/support.en";
import { SUPPORT_WORDS } from "./admin-words/support";
import type { WorkMessages } from "./admin-messages/work.en";
import { WORK_WORDS } from "./admin-words/work";
import type { AssistantMessages } from "./admin-messages/assistant.en";
import { ASSISTANT_WORDS } from "./admin-words/assistant";
import type { StaffEmailsMessages } from "./admin-messages/staff-emails.en";
import { STAFF_EMAILS_WORDS } from "./admin-words/staff-emails";
import type { PlatformMessages } from "./admin-messages/platform.en";
import { PLATFORM_WORDS } from "./admin-words/platform";
import type { PlatformSiteMessages } from "./admin-messages/platform-site.en";
import { PLATFORM_SITE_WORDS } from "./admin-words/platform-site";
import { platformToolsEn, type PlatformToolsMessages } from "./admin-messages/platform-tools.en";
import { platformToolsNb } from "./admin-messages/platform-tools.nb";
import { bookingsEn, type BookingsMessages } from "./admin-messages/bookings.en";
import { bookingsNb } from "./admin-messages/bookings.nb";
import { capacityEn, type CapacityMessages } from "./admin-messages/capacity.en";
import { capacityNb } from "./admin-messages/capacity.nb";
import { loyaltyEn, type LoyaltyMessages } from "./admin-messages/loyalty.en";
import { loyaltyNb } from "./admin-messages/loyalty.nb";
import { homeEn, type HomeMessages } from "./admin-messages/home.en";
import { homeNb } from "./admin-messages/home.nb";
import { platformLegalEn, type PlatformLegalMessages } from "./admin-messages/platform-legal.en";
import { platformLegalNb } from "./admin-messages/platform-legal.nb";
import { shellEn, type ShellMessages } from "./admin-messages/shell.en";
import { shellNb } from "./admin-messages/shell.nb";
import { setupEn, type SetupMessages } from "./admin-messages/setup.en";
import { setupNb } from "./admin-messages/setup.nb";
import type { SignInMessages } from "./admin-messages/sign-in.en";
import { SIGN_IN_WORDS } from "./admin-words/sign-in";
import { blogEn, type BlogMessages } from "./admin-messages/blog.en";
import { blogNb } from "./admin-messages/blog.nb";
import { schedulesEn, type SchedulesMessages } from "./admin-messages/schedules.en";
import { schedulesNb } from "./admin-messages/schedules.nb";
import type { OauthMessages } from "./admin-messages/oauth.en";
import { OAUTH_WORDS } from "./admin-words/oauth";
import type { SandboxMessages } from "./admin-messages/sandbox.en";
import { SANDBOX_WORDS } from "./admin-words/sandbox";

/**
 * The admin's words by area and language (D312, `docs/platform-admin-i18n.md` 3.3): one pair of catalogues per area in
 * `src/lib/admin-messages/{area}.{lang}.ts`, English the type. A new area is its two files and an entry here; an area is converted with
 * the screens that show it, and `admin-strings.scan.test.ts` holds what is converted. An area that code outside the admin reads has an
 * index module, `src/lib/admin-words/{stem}.ts`, and its entry here is that pair (bloat review step 0.7).
 */
export type AdminAreaMessages = {
  common: CommonMessages;
  domains: DomainsMessages;
  home: HomeMessages;
  customers: CustomersMessages;
  privacy: PrivacyMessages;
  marketing: MarketingMessages;
  discounts: DiscountsMessages;
  loyalty: LoyaltyMessages;
  platform: PlatformMessages;
  platformSite: PlatformSiteMessages;
  platformTools: PlatformToolsMessages;
  bookings: BookingsMessages;
  support: SupportMessages;
  work: WorkMessages;
  assistant: AssistantMessages;
  staffEmails: StaffEmailsMessages;
  analytics: AnalyticsMessages;
  finance: FinanceMessages;
  taxReports: TaxReportsMessages;
  reports: ReportsMessages;
  customReports: CustomReportsMessages;
  settings: SettingsMessages;
  tax: TaxMessages;
  payments: PaymentsMessages;
  shipping: ShippingMessages;
  carriers: CarriersMessages;
  fiken: FikenMessages;
  deals: DealsMessages;
  console: ConsoleMessages;
  business: BusinessMessages;
  books: BooksMessages;
  screens: ScreensMessages;
  storeParts: StorePartsMessages;
  backdrops: BackdropsMessages;
  animation: AnimationMessages;
  notifications: NotificationsMessages;
  legal: LegalMessages;
  staff: StaffMessages;
  billing: BillingMessages;
  capacity: CapacityMessages;
  builder: BuilderMessages;
  blocks: BlocksMessages;
  website: WebsiteMessages;
  design: DesignMessages;
  redirects: RedirectsMessages;
  moving: MovingMessages;
  experiments: ExperimentsMessages;
  products: ProductsMessages;
  product: ProductMessages;
  inventory: InventoryMessages;
  giftCards: GiftCardsMessages;
  reviews: ReviewsMessages;
  fields: FieldsMessages;
  content: ContentMessages;
  orders: OrdersMessages;
  order: OrderMessages;
  drafts: DraftsMessages;
  returns: ReturnsMessages;
  invoices: InvoicesMessages;
  platformLegal: PlatformLegalMessages;
  setup: SetupMessages;
  shell: ShellMessages;
  signIn: SignInMessages;
  blog: BlogMessages;
  schedules: SchedulesMessages;
  oauth: OauthMessages;
  sandbox: SandboxMessages;
};

export type AdminArea = keyof AdminAreaMessages;

/**
 * Areas only the server reads: a page draws them, or hands its client parts the words they need as props. The browser's English fallback
 * (`useAdminText()` in `admin-text.tsx`) leaves them out, so they are not in every admin screen's first scripts (PSI PERF-01,
 * `admin-catalogues.scan.test.ts`), and a client part cannot ask for one.
 */
export const SERVER_AREAS = ["carriers", "sandbox", "fiken", "deals", "screens", "storeParts", "backdrops", "animation", "console", "business", "books"] as const;

/** An area a client part may read with `useAdminText()`. */
export type ClientArea = Exclude<AdminArea, (typeof SERVER_AREAS)[number]>;

/**
 * Server-only areas a page may hand down to a client part whose English is in its own module already (`useHandedText()`): the builder's
 * shop parts, named in `store-parts.ts`, its backdrops and layers (D534), named in `backdrops.ts`, and its Animation component (D538), named
 * in `animation-words.ts`. Handed down only where a page draws
 * that part, in another language than English.
 */
export type HandedArea = "storeParts" | "backdrops" | "animation";

const CATALOGUES: { [A in AdminArea]: Record<AdminLang, AdminAreaMessages[A]> } = {
  common: COMMON_WORDS,
  domains: { en: domainsEn, nb: domainsNb },
  home: { en: homeEn, nb: homeNb },
  customers: CUSTOMERS_WORDS,
  privacy: { en: privacyEn, nb: privacyNb },
  marketing: { en: marketingEn, nb: marketingNb },
  discounts: { en: discountsEn, nb: discountsNb },
  loyalty: { en: loyaltyEn, nb: loyaltyNb },
  platform: PLATFORM_WORDS,
  platformSite: PLATFORM_SITE_WORDS,
  platformTools: { en: platformToolsEn, nb: platformToolsNb },
  bookings: { en: bookingsEn, nb: bookingsNb },
  support: SUPPORT_WORDS,
  work: WORK_WORDS,
  assistant: ASSISTANT_WORDS,
  staffEmails: STAFF_EMAILS_WORDS,
  analytics: { en: analyticsEn, nb: analyticsNb },
  finance: { en: financeEn, nb: financeNb },
  taxReports: { en: taxReportsEn, nb: taxReportsNb },
  reports: REPORTS_WORDS,
  customReports: CUSTOM_REPORTS_WORDS,
  settings: { en: settingsEn, nb: settingsNb },
  tax: { en: taxEn, nb: taxNb },
  payments: { en: paymentsEn, nb: paymentsNb },
  shipping: { en: shippingEn, nb: shippingNb },
  carriers: { en: carriersEn, nb: carriersNb },
  fiken: { en: fikenEn, nb: fikenNb },
  deals: { en: dealsEn, nb: dealsNb },
  console: { en: consoleEn, nb: consoleNb },
  business: { en: businessEn, nb: businessNb },
  books: BOOKS_WORDS,
  screens: SCREENS_WORDS,
  storeParts: { en: storePartsEn, nb: storePartsNb },
  backdrops: { en: backdropsEn, nb: backdropsNb },
  animation: { en: animationEn, nb: animationNb },
  notifications: { en: notificationsEn, nb: notificationsNb },
  legal: { en: legalEn, nb: legalNb },
  staff: { en: staffEn, nb: staffNb },
  billing: { en: billingEn, nb: billingNb },
  capacity: { en: capacityEn, nb: capacityNb },
  builder: { en: builderEn, nb: builderNb },
  blocks: { en: blocksEn, nb: blocksNb },
  website: WEBSITE_WORDS,
  design: { en: designEn, nb: designNb },
  redirects: { en: redirectsEn, nb: redirectsNb },
  moving: { en: movingEn, nb: movingNb },
  experiments: EXPERIMENTS_WORDS,
  products: { en: productsEn, nb: productsNb },
  product: { en: productEn, nb: productNb },
  inventory: { en: inventoryEn, nb: inventoryNb },
  giftCards: { en: giftCardsEn, nb: giftCardsNb },
  reviews: { en: reviewsEn, nb: reviewsNb },
  fields: { en: fieldsEn, nb: fieldsNb },
  content: { en: contentEn, nb: contentNb },
  orders: { en: ordersEn, nb: ordersNb },
  order: ORDER_WORDS,
  drafts: { en: draftsEn, nb: draftsNb },
  returns: { en: returnsEn, nb: returnsNb },
  invoices: INVOICES_WORDS,
  platformLegal: { en: platformLegalEn, nb: platformLegalNb },
  setup: { en: setupEn, nb: setupNb },
  shell: { en: shellEn, nb: shellNb },
  signIn: SIGN_IN_WORDS,
  blog: { en: blogEn, nb: blogNb },
  schedules: { en: schedulesEn, nb: schedulesNb },
  oauth: OAUTH_WORDS,
  sandbox: SANDBOX_WORDS,
};

/** An area's words in `lang`, on the server; a client part reads its area's slice through `useAdminText()`. */
export function adminText<A extends AdminArea>(lang: AdminLang, area: A): AdminAreaMessages[A] {
  return CATALOGUES[area][lang];
}

/** The slices a layout hands to its client parts (`AdminTextProvider`): the areas named, in `lang`. */
export function adminTexts<A extends AdminArea>(lang: AdminLang, areas: readonly A[]): Pick<AdminAreaMessages, A> {
  return Object.fromEntries(areas.map((area) => [area, adminText(lang, area)])) as Pick<AdminAreaMessages, A>;
}

