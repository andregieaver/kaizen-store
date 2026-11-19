import type { AdminLang } from "./admin-lang";
import type { CommonMessages } from "./admin-messages/common.en";
import { COMMON_WORDS } from "./admin-words/common";
import type { DomainsMessages } from "./admin-messages/domains.en";
import { DOMAINS_WORDS } from "./admin-words/domains";
import type { OrdersMessages } from "./admin-messages/orders.en";
import { ORDERS_WORDS } from "./admin-words/orders";
import type { OrderMessages } from "./admin-messages/order.en";
import { ORDER_WORDS } from "./admin-words/order";
import type { DraftsMessages } from "./admin-messages/drafts.en";
import { DRAFTS_WORDS } from "./admin-words/drafts";
import type { ReturnsMessages } from "./admin-messages/returns.en";
import { RETURNS_WORDS } from "./admin-words/returns";
import type { InvoicesMessages } from "./admin-messages/invoices.en";
import { INVOICES_WORDS } from "./admin-words/invoices";
import type { ProductsMessages } from "./admin-messages/products.en";
import { PRODUCTS_WORDS } from "./admin-words/products";
import type { ProductMessages } from "./admin-messages/product.en";
import { PRODUCT_WORDS } from "./admin-words/product";
import type { InventoryMessages } from "./admin-messages/inventory.en";
import { INVENTORY_WORDS } from "./admin-words/inventory";
import type { GiftCardsMessages } from "./admin-messages/gift-cards.en";
import { GIFT_CARDS_WORDS } from "./admin-words/gift-cards";
import type { ReviewsMessages } from "./admin-messages/reviews.en";
import { REVIEWS_WORDS } from "./admin-words/reviews";
import type { ContentMessages } from "./admin-messages/content.en";
import { CONTENT_WORDS } from "./admin-words/content";
import type { FieldsMessages } from "./admin-messages/fields.en";
import { FIELDS_WORDS } from "./admin-words/fields";
import type { CustomersMessages } from "./admin-messages/customers.en";
import { CUSTOMERS_WORDS } from "./admin-words/customers";
import type { PrivacyMessages } from "./admin-messages/privacy.en";
import { PRIVACY_WORDS } from "./admin-words/privacy";
import type { MarketingMessages } from "./admin-messages/marketing.en";
import { MARKETING_WORDS } from "./admin-words/marketing";
import type { DiscountsMessages } from "./admin-messages/discounts.en";
import { DISCOUNTS_WORDS } from "./admin-words/discounts";
import type { BuilderMessages } from "./admin-messages/builder.en";
import { BUILDER_WORDS } from "./admin-words/builder";
import type { BlocksMessages } from "./admin-messages/blocks.en";
import { BLOCKS_WORDS } from "./admin-words/blocks";
import type { WebsiteMessages } from "./admin-messages/website.en";
import { WEBSITE_WORDS } from "./admin-words/website";
import type { DesignMessages } from "./admin-messages/design.en";
import { DESIGN_WORDS } from "./admin-words/design";
import type { MovingMessages } from "./admin-messages/moving.en";
import { MOVING_WORDS } from "./admin-words/moving";
import type { RedirectsMessages } from "./admin-messages/redirects.en";
import { REDIRECTS_WORDS } from "./admin-words/redirects";
import type { FormsMessages } from "./admin-messages/forms.en";
import { FORMS_WORDS } from "./admin-words/forms";
import type { FormTemplatesMessages } from "./admin-messages/form-templates.en";
import { FORM_TEMPLATES_WORDS } from "./admin-words/form-templates";
import type { ExperimentsMessages } from "./admin-messages/experiments.en";
import { EXPERIMENTS_WORDS } from "./admin-words/experiments";
import type { SettingsMessages } from "./admin-messages/settings.en";
import { SETTINGS_WORDS } from "./admin-words/settings";
import type { TaxMessages } from "./admin-messages/tax.en";
import { TAX_WORDS } from "./admin-words/tax";
import type { PaymentsMessages } from "./admin-messages/payments.en";
import { PAYMENTS_WORDS } from "./admin-words/payments";
import type { ShippingMessages } from "./admin-messages/shipping.en";
import { SHIPPING_WORDS } from "./admin-words/shipping";
import type { CarriersMessages } from "./admin-messages/carriers.en";
import { CARRIERS_WORDS } from "./admin-words/carriers";
import type { FikenMessages } from "./admin-messages/fiken.en";
import { FIKEN_WORDS } from "./admin-words/fiken";
import type { ConsoleMessages } from "./admin-messages/console.en";
import { CONSOLE_WORDS } from "./admin-words/console";
import type { BusinessMessages } from "./admin-messages/business.en";
import { BUSINESS_WORDS } from "./admin-words/business";
import type { BooksMessages } from "./admin-messages/books.en";
import { BOOKS_WORDS } from "./admin-words/books";
import type { DealsMessages } from "./admin-messages/deals.en";
import { DEALS_WORDS } from "./admin-words/deals";
import type { ScreensMessages } from "./admin-messages/screens.en";
import { SCREENS_WORDS } from "./admin-words/screens";
import type { StorePartsMessages } from "./admin-messages/store-parts.en";
import { STORE_PARTS_WORDS } from "./admin-words/store-parts";
import type { BackdropsMessages } from "./admin-messages/backdrops.en";
import { BACKDROPS_WORDS } from "./admin-words/backdrops";
import type { AnimationMessages } from "./admin-messages/animation.en";
import { ANIMATION_WORDS } from "./admin-words/animation";
import type { HeatmapsMessages } from "./admin-messages/heatmaps.en";
import { HEATMAPS_WORDS } from "./admin-words/heatmaps";
import type { RecordingsMessages } from "./admin-messages/recordings.en";
import { RECORDINGS_WORDS } from "./admin-words/recordings";
import type { PrivacyOfficerMessages } from "./admin-messages/privacy-officer.en";
import { PRIVACY_OFFICER_WORDS } from "./admin-words/privacy-officer";
import type { FlowsMessages } from "./admin-messages/flows.en";
import { FLOWS_WORDS } from "./admin-words/flows";
import type { AutomaticMessages } from "./admin-messages/automatic.en";
import { AUTOMATIC_WORDS } from "./admin-words/automatic";
import type { NotificationsMessages } from "./admin-messages/notifications.en";
import { NOTIFICATIONS_WORDS } from "./admin-words/notifications";
import type { LegalMessages } from "./admin-messages/legal.en";
import { LEGAL_WORDS } from "./admin-words/legal";
import type { StaffMessages } from "./admin-messages/staff.en";
import { STAFF_WORDS } from "./admin-words/staff";
import type { BillingMessages } from "./admin-messages/billing.en";
import { BILLING_WORDS } from "./admin-words/billing";
import type { AnalyticsMessages } from "./admin-messages/analytics.en";
import { ANALYTICS_WORDS } from "./admin-words/analytics";
import type { FinanceMessages } from "./admin-messages/finance.en";
import { FINANCE_WORDS } from "./admin-words/finance";
import type { TaxReportsMessages } from "./admin-messages/tax-reports.en";
import { TAX_REPORTS_WORDS } from "./admin-words/tax-reports";
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
import type { PlatformToolsMessages } from "./admin-messages/platform-tools.en";
import { PLATFORM_TOOLS_WORDS } from "./admin-words/platform-tools";
import type { BookingsMessages } from "./admin-messages/bookings.en";
import { BOOKINGS_WORDS } from "./admin-words/bookings";
import type { CapacityMessages } from "./admin-messages/capacity.en";
import { CAPACITY_WORDS } from "./admin-words/capacity";
import type { LoyaltyMessages } from "./admin-messages/loyalty.en";
import { LOYALTY_WORDS } from "./admin-words/loyalty";
import type { HomeMessages } from "./admin-messages/home.en";
import { HOME_WORDS } from "./admin-words/home";
import type { PlatformLegalMessages } from "./admin-messages/platform-legal.en";
import { PLATFORM_LEGAL_WORDS } from "./admin-words/platform-legal";
import type { ShellMessages } from "./admin-messages/shell.en";
import { SHELL_WORDS } from "./admin-words/shell";
import type { SetupMessages } from "./admin-messages/setup.en";
import { SETUP_WORDS } from "./admin-words/setup";
import type { SignInMessages } from "./admin-messages/sign-in.en";
import { SIGN_IN_WORDS } from "./admin-words/sign-in";
import type { BlogMessages } from "./admin-messages/blog.en";
import { BLOG_WORDS } from "./admin-words/blog";
import type { SchedulesMessages } from "./admin-messages/schedules.en";
import { SCHEDULES_WORDS } from "./admin-words/schedules";
import type { OauthMessages } from "./admin-messages/oauth.en";
import { OAUTH_WORDS } from "./admin-words/oauth";
import type { SandboxMessages } from "./admin-messages/sandbox.en";
import { SANDBOX_WORDS } from "./admin-words/sandbox";
import type { HouseAutopilotMessages } from "./admin-messages/house-autopilot.en";
import { HOUSE_AUTOPILOT_WORDS } from "./admin-words/house-autopilot";
import type { KitMessages } from "./admin-messages/kit.en";
import { KIT_WORDS } from "./admin-words/kit";
import { BUILDER_TEXT_WORDS } from "./admin-words/builder-text";
import { WEBSITE_PICK_WORDS } from "./admin-words/website-pick";
import { ASSISTANT_BAR_WORDS } from "./admin-words/assistant-bar";
import { HOME_DRAFTS_WORDS } from "./admin-words/home-drafts";
import { WEBSITE_LIST_WORDS } from "./admin-words/website-list";
import { FIELDS_EDITOR_WORDS } from "./admin-words/fields-editor";
import { PRODUCTS_EDITOR_WORDS } from "./admin-words/products-editor";
import { DESIGN_EDITOR_WORDS } from "./admin-words/design-editor";
import { BLOG_EDITOR_WORDS } from "./admin-words/blog-editor";
import { SCHEDULES_EDITOR_WORDS } from "./admin-words/schedules-editor";
import { NOTIFICATIONS_INTEGRATIONS_WORDS } from "./admin-words/notifications-integrations";
import { NOTIFICATIONS_GOOGLE_WORDS } from "./admin-words/notifications-google";
import { NOTIFICATIONS_TOKENS_WORDS } from "./admin-words/notifications-tokens";
import { NOTIFICATIONS_WORKFLOWS_WORDS } from "./admin-words/notifications-workflows";
import { SETTINGS_HOURS_WORDS } from "./admin-words/settings-hours";
import { SETTINGS_AI_WORDS } from "./admin-words/settings-ai";
import { SETTINGS_PRODUCER_WORDS } from "./admin-words/settings-producer";
import { SETTINGS_COMPANY_WORDS } from "./admin-words/settings-company";
import { SETTINGS_PRICE_RULES_WORDS } from "./admin-words/settings-price-rules";
import { SETTINGS_FEATURES_WORDS } from "./admin-words/settings-features";
import { SETTINGS_PRICES_WORDS } from "./admin-words/settings-prices";
import { SUPPORT_SETTINGS_WORDS } from "./admin-words/support-settings";
import { ANALYTICS_EXPORT_WORDS } from "./admin-words/analytics-export";
import { REPORTS_CAMPAIGNS_WORDS } from "./admin-words/reports-campaigns";
import { PLATFORM_COPY_WORDS } from "./admin-words/platform-copy";
import { PLATFORM_DOCS_GUIDE_WORDS } from "./admin-words/platform-docs-guide";
import { PLATFORM_REMINDERS_WORDS } from "./admin-words/platform-reminders";
import { BUILDER_VERSIONS_WORDS } from "./admin-words/builder-versions";
import { WEBSITE_STAGING_WORDS } from "./admin-words/website-staging";
import { WEBSITE_MEDIA_WORDS } from "./admin-words/website-media";
import { WEBSITE_MENUS_WORDS } from "./admin-words/website-menus";
import { INVENTORY_IMPORT_WORDS } from "./admin-words/inventory-import";
import { CUSTOMERS_STAFF_WORDS } from "./admin-words/customers-staff";
import { BLOCKS_FORM_WORDS } from "./admin-words/blocks-form";

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
  heatmaps: HeatmapsMessages;
  recordings: RecordingsMessages;
  privacyOfficer: PrivacyOfficerMessages;
  flows: FlowsMessages;
  notifications: NotificationsMessages;
  automatic: AutomaticMessages;
  legal: LegalMessages;
  staff: StaffMessages;
  billing: BillingMessages;
  capacity: CapacityMessages;
  builder: BuilderMessages;
  blocks: BlocksMessages;
  website: WebsiteMessages;
  design: DesignMessages;
  redirects: RedirectsMessages;
  forms: FormsMessages;
  formTemplates: FormTemplatesMessages;
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
  houseAutopilot: HouseAutopilotMessages;
  /** The admin kit's own words (code review 1.12, D818): `Pager` and `ListSearch`, drawn on the server. */
  kit: KitMessages;
  /** Cuts (bloat review step 2.27, `cut()` in `src/lib/admin-area.ts`, each a module in `src/lib/admin-words`): some groups of an area, the same objects, for screens whose parts read only those. */
  builderText: Pick<BuilderMessages, "richText" | "textStyles" | "responsive">;
  websitePick: Pick<WebsiteMessages, "picker" | "pictureMaker">;
  /** The AI manager's button and notices, on every screen; the chat's words (`assistant`) come with its start call. */
  assistantBar: Pick<AssistantMessages, "name" | "launcher" | "notices">;
  homeDrafts: Pick<HomeMessages, "drafts">;
  websiteList: Pick<WebsiteMessages, "list" | "pageJobs" | "demoHomes">;
  /** The page editor's cuts: the groups its parts read, also handed where those parts are drawn on their own (a product, a category). */
  fieldsEditor: Pick<FieldsMessages, "form" | "pickers" | "linkKinds">;
  productsEditor: Pick<ProductsMessages, "terms" | "termFields" | "termPage" | "termRules" | "termSeo">;
  designEditor: Pick<DesignMessages, "fonts" | "changes">;
  blogEditor: Pick<BlogMessages, "editor">;
  schedulesEditor: Pick<SchedulesMessages, "dialog" | "nouns" | "share">;
  /** Cuts of the screens' own areas (bloat review step 2.27, commit 5): the groups the parts under each screen read. */
  notificationsIntegrations: Pick<NotificationsMessages, "integrations">;
  notificationsGoogle: Pick<NotificationsMessages, "google">;
  notificationsTokens: Pick<NotificationsMessages, "apiTokens" | "customApps" | "storefrontTokens">;
  notificationsWorkflows: Pick<NotificationsMessages, "workflows">;
  settingsHours: Pick<SettingsMessages, "hours">;
  settingsAi: Pick<SettingsMessages, "ai" | "common">;
  settingsProducer: Pick<SettingsMessages, "producer">;
  settingsCompany: Pick<SettingsMessages, "company">;
  settingsPriceRules: Pick<SettingsMessages, "priceRules">;
  settingsFeatures: Pick<SettingsMessages, "features">;
  settingsPrices: Pick<SettingsMessages, "common" | "prices">;
  supportSettings: Pick<SupportMessages, "settings">;
  analyticsExport: Pick<AnalyticsMessages, "exportButton">;
  reportsCampaigns: Pick<ReportsMessages, "campaigns" | "channels">;
  platformCopy: Pick<PlatformMessages, "copyWizard" | "copyProgress">;
  platformDocsGuide: Pick<PlatformMessages, "docsGuide">;
  platformReminders: Pick<PlatformMessages, "reminderEditor">;
  builderVersions: Pick<BuilderMessages, "differences" | "blockNames">;
  websiteStaging: Pick<WebsiteMessages, "staging">;
  websiteMedia: Pick<WebsiteMessages, "media">;
  websiteMenus: Pick<WebsiteMessages, "menus">;
  inventoryImport: Pick<InventoryMessages, "import">;
  customersStaff: Pick<CustomersMessages, "staff">;
  blocksForm: Pick<BlocksMessages, "form" | "lists">;
};

export type AdminArea = keyof AdminAreaMessages;

/**
 * Areas only the server reads: a page draws them, or hands its client parts the words they need as props. The browser's English fallback
 * (`useAdminText()` in `admin-text.tsx`) leaves them out, so they are not in every admin screen's first scripts (PSI PERF-01,
 * `admin-catalogues.scan.test.ts`), and a client part cannot ask for one.
 */
export const SERVER_AREAS = ["carriers", "sandbox", "fiken", "deals", "screens", "storeParts", "backdrops", "animation", "console", "business", "books", "heatmaps", "recordings", "privacyOfficer", "flows", "automatic", "houseAutopilot", "kit"] as const;

/** An area a client part may read with `useAdminText()`. */
export type ClientArea = Exclude<AdminArea, (typeof SERVER_AREAS)[number]>;

/**
 * Server-only areas a page may hand down to a client part whose English is in its own module already (`useHandedText()`): the builder's
 * shop parts, named in `store-parts.ts`, its backdrops and layers (D534), named in `backdrops.ts`, and its Animation component (D538), named
 * in `animation-words.ts`. Handed down only where a page draws
 * that part, in another language than English.
 */
export type HandedArea = "storeParts" | "backdrops" | "animation";

/**
 * Going away (bloat review step 2.25): read an area as its module in src/lib/admin-words indexed by the language (<AREA>_WORDS[lang]),
 * several with areaTexts(); this table is deleted when no caller is left.
 */
const CATALOGUES: { [A in AdminArea]: Record<AdminLang, AdminAreaMessages[A]> } = {
  common: COMMON_WORDS,
  domains: DOMAINS_WORDS,
  home: HOME_WORDS,
  customers: CUSTOMERS_WORDS,
  privacy: PRIVACY_WORDS,
  marketing: MARKETING_WORDS,
  discounts: DISCOUNTS_WORDS,
  loyalty: LOYALTY_WORDS,
  platform: PLATFORM_WORDS,
  platformSite: PLATFORM_SITE_WORDS,
  platformTools: PLATFORM_TOOLS_WORDS,
  bookings: BOOKINGS_WORDS,
  support: SUPPORT_WORDS,
  work: WORK_WORDS,
  assistant: ASSISTANT_WORDS,
  staffEmails: STAFF_EMAILS_WORDS,
  analytics: ANALYTICS_WORDS,
  finance: FINANCE_WORDS,
  taxReports: TAX_REPORTS_WORDS,
  reports: REPORTS_WORDS,
  customReports: CUSTOM_REPORTS_WORDS,
  settings: SETTINGS_WORDS,
  tax: TAX_WORDS,
  payments: PAYMENTS_WORDS,
  shipping: SHIPPING_WORDS,
  carriers: CARRIERS_WORDS,
  fiken: FIKEN_WORDS,
  deals: DEALS_WORDS,
  console: CONSOLE_WORDS,
  business: BUSINESS_WORDS,
  books: BOOKS_WORDS,
  screens: SCREENS_WORDS,
  storeParts: STORE_PARTS_WORDS,
  backdrops: BACKDROPS_WORDS,
  animation: ANIMATION_WORDS,
  heatmaps: HEATMAPS_WORDS,
  recordings: RECORDINGS_WORDS,
  privacyOfficer: PRIVACY_OFFICER_WORDS,
  flows: FLOWS_WORDS,
  notifications: NOTIFICATIONS_WORDS,
  automatic: AUTOMATIC_WORDS,
  legal: LEGAL_WORDS,
  staff: STAFF_WORDS,
  billing: BILLING_WORDS,
  capacity: CAPACITY_WORDS,
  builder: BUILDER_WORDS,
  blocks: BLOCKS_WORDS,
  website: WEBSITE_WORDS,
  design: DESIGN_WORDS,
  redirects: REDIRECTS_WORDS,
  forms: FORMS_WORDS,
  formTemplates: FORM_TEMPLATES_WORDS,
  moving: MOVING_WORDS,
  experiments: EXPERIMENTS_WORDS,
  products: PRODUCTS_WORDS,
  product: PRODUCT_WORDS,
  inventory: INVENTORY_WORDS,
  giftCards: GIFT_CARDS_WORDS,
  reviews: REVIEWS_WORDS,
  fields: FIELDS_WORDS,
  content: CONTENT_WORDS,
  orders: ORDERS_WORDS,
  order: ORDER_WORDS,
  drafts: DRAFTS_WORDS,
  returns: RETURNS_WORDS,
  invoices: INVOICES_WORDS,
  platformLegal: PLATFORM_LEGAL_WORDS,
  setup: SETUP_WORDS,
  shell: SHELL_WORDS,
  signIn: SIGN_IN_WORDS,
  blog: BLOG_WORDS,
  schedules: SCHEDULES_WORDS,
  oauth: OAUTH_WORDS,
  sandbox: SANDBOX_WORDS,
  houseAutopilot: HOUSE_AUTOPILOT_WORDS,
  kit: KIT_WORDS,
  builderText: BUILDER_TEXT_WORDS,
  websitePick: WEBSITE_PICK_WORDS,
  assistantBar: ASSISTANT_BAR_WORDS,
  homeDrafts: HOME_DRAFTS_WORDS,
  websiteList: WEBSITE_LIST_WORDS,
  fieldsEditor: FIELDS_EDITOR_WORDS,
  productsEditor: PRODUCTS_EDITOR_WORDS,
  designEditor: DESIGN_EDITOR_WORDS,
  blogEditor: BLOG_EDITOR_WORDS,
  schedulesEditor: SCHEDULES_EDITOR_WORDS,
  notificationsIntegrations: NOTIFICATIONS_INTEGRATIONS_WORDS,
  notificationsGoogle: NOTIFICATIONS_GOOGLE_WORDS,
  notificationsTokens: NOTIFICATIONS_TOKENS_WORDS,
  notificationsWorkflows: NOTIFICATIONS_WORKFLOWS_WORDS,
  settingsHours: SETTINGS_HOURS_WORDS,
  settingsAi: SETTINGS_AI_WORDS,
  settingsProducer: SETTINGS_PRODUCER_WORDS,
  settingsCompany: SETTINGS_COMPANY_WORDS,
  settingsPriceRules: SETTINGS_PRICE_RULES_WORDS,
  settingsFeatures: SETTINGS_FEATURES_WORDS,
  settingsPrices: SETTINGS_PRICES_WORDS,
  supportSettings: SUPPORT_SETTINGS_WORDS,
  analyticsExport: ANALYTICS_EXPORT_WORDS,
  reportsCampaigns: REPORTS_CAMPAIGNS_WORDS,
  platformCopy: PLATFORM_COPY_WORDS,
  platformDocsGuide: PLATFORM_DOCS_GUIDE_WORDS,
  platformReminders: PLATFORM_REMINDERS_WORDS,
  builderVersions: BUILDER_VERSIONS_WORDS,
  websiteStaging: WEBSITE_STAGING_WORDS,
  websiteMedia: WEBSITE_MEDIA_WORDS,
  websiteMenus: WEBSITE_MENUS_WORDS,
  inventoryImport: INVENTORY_IMPORT_WORDS,
  customersStaff: CUSTOMERS_STAFF_WORDS,
  blocksForm: BLOCKS_FORM_WORDS,
};

/** An area's words in `lang`, on the server; a client part reads its area's slice through `useAdminText()`. */
export function adminText<A extends AdminArea>(lang: AdminLang, area: A): AdminAreaMessages[A] {
  return CATALOGUES[area][lang];
}

/** The slices a layout hands to its client parts (`AdminTextProvider`): the areas named, in `lang`. */
export function adminTexts<A extends AdminArea>(lang: AdminLang, areas: readonly A[]): Pick<AdminAreaMessages, A> {
  return Object.fromEntries(areas.map((area) => [area, adminText(lang, area)])) as Pick<AdminAreaMessages, A>;
}

