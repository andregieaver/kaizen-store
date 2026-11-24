import type { CommonMessages } from "./admin-messages/common.en";
import type { DomainsMessages } from "./admin-messages/domains.en";
import type { OrdersMessages } from "./admin-messages/orders.en";
import type { OrderMessages } from "./admin-messages/order.en";
import type { DraftsMessages } from "./admin-messages/drafts.en";
import type { ReturnsMessages } from "./admin-messages/returns.en";
import type { InvoicesMessages } from "./admin-messages/invoices.en";
import type { ProductsMessages } from "./admin-messages/products.en";
import type { ProductMessages } from "./admin-messages/product.en";
import type { InventoryMessages } from "./admin-messages/inventory.en";
import type { GiftCardsMessages } from "./admin-messages/gift-cards.en";
import type { ReviewsMessages } from "./admin-messages/reviews.en";
import type { ContentMessages } from "./admin-messages/content.en";
import type { FieldsMessages } from "./admin-messages/fields.en";
import type { CustomersMessages } from "./admin-messages/customers.en";
import type { PrivacyMessages } from "./admin-messages/privacy.en";
import type { MarketingMessages } from "./admin-messages/marketing.en";
import type { DiscountsMessages } from "./admin-messages/discounts.en";
import type { BuilderMessages } from "./admin-messages/builder.en";
import type { BlocksMessages } from "./admin-messages/blocks.en";
import type { WebsiteMessages } from "./admin-messages/website.en";
import type { DesignMessages } from "./admin-messages/design.en";
import type { MovingMessages } from "./admin-messages/moving.en";
import type { RedirectsMessages } from "./admin-messages/redirects.en";
import type { FormsMessages } from "./admin-messages/forms.en";
import type { FormTemplatesMessages } from "./admin-messages/form-templates.en";
import type { ExperimentsMessages } from "./admin-messages/experiments.en";
import type { SettingsMessages } from "./admin-messages/settings.en";
import type { TaxMessages } from "./admin-messages/tax.en";
import type { PaymentsMessages } from "./admin-messages/payments.en";
import type { ShippingMessages } from "./admin-messages/shipping.en";
import type { CarriersMessages } from "./admin-messages/carriers.en";
import type { FikenMessages } from "./admin-messages/fiken.en";
import type { ConsoleMessages } from "./admin-messages/console.en";
import type { BusinessMessages } from "./admin-messages/business.en";
import type { BooksMessages } from "./admin-messages/books.en";
import type { DealsMessages } from "./admin-messages/deals.en";
import type { ScreensMessages } from "./admin-messages/screens.en";
import type { StorePartsMessages } from "./admin-messages/store-parts.en";
import type { BackdropsMessages } from "./admin-messages/backdrops.en";
import type { ConsentLookMessages } from "./admin-messages/consent-look.en";
import type { AnimationMessages } from "./admin-messages/animation.en";
import type { HeatmapsMessages } from "./admin-messages/heatmaps.en";
import type { RecordingsMessages } from "./admin-messages/recordings.en";
import type { CompaniesMessages } from "./admin-messages/companies.en";
import type { PrivacyOfficerMessages } from "./admin-messages/privacy-officer.en";
import type { FlowsMessages } from "./admin-messages/flows.en";
import type { AutomaticMessages } from "./admin-messages/automatic.en";
import type { NotificationsMessages } from "./admin-messages/notifications.en";
import type { LegalMessages } from "./admin-messages/legal.en";
import type { StaffMessages } from "./admin-messages/staff.en";
import type { BillingMessages } from "./admin-messages/billing.en";
import type { AnalyticsMessages } from "./admin-messages/analytics.en";
import type { FinanceMessages } from "./admin-messages/finance.en";
import type { TaxReportsMessages } from "./admin-messages/tax-reports.en";
import type { ReportsMessages } from "./admin-messages/reports.en";
import type { CustomReportsMessages } from "./admin-messages/custom-reports.en";
import type { SupportMessages } from "./admin-messages/support.en";
import type { WorkMessages } from "./admin-messages/work.en";
import type { AssistantMessages } from "./admin-messages/assistant.en";
import type { StaffEmailsMessages } from "./admin-messages/staff-emails.en";
import type { PlatformMessages } from "./admin-messages/platform.en";
import type { PlatformSiteMessages } from "./admin-messages/platform-site.en";
import type { PlatformToolsMessages } from "./admin-messages/platform-tools.en";
import type { BookingsMessages } from "./admin-messages/bookings.en";
import type { CapacityMessages } from "./admin-messages/capacity.en";
import type { LoyaltyMessages } from "./admin-messages/loyalty.en";
import type { HomeMessages } from "./admin-messages/home.en";
import type { PlatformLegalMessages } from "./admin-messages/platform-legal.en";
import type { ShellMessages } from "./admin-messages/shell.en";
import type { SetupMessages } from "./admin-messages/setup.en";
import type { SignInMessages } from "./admin-messages/sign-in.en";
import type { BlogMessages } from "./admin-messages/blog.en";
import type { SchedulesMessages } from "./admin-messages/schedules.en";
import type { OauthMessages } from "./admin-messages/oauth.en";
import type { SandboxMessages } from "./admin-messages/sandbox.en";
import type { HouseAutopilotMessages } from "./admin-messages/house-autopilot.en";
import type { LeadScoreMessages } from "./admin-messages/lead-score.en";
import type { FlowSplitsMessages } from "./admin-messages/flow-splits.en";
import type { SendAllowanceMessages } from "./admin-messages/send-allowance.en";
import type { KitMessages } from "./admin-messages/kit.en";

/**
 * The admin's words by area and language (D312, `docs/platform-admin-i18n.md` 3.3): one pair of catalogues per area in
 * `src/lib/admin-messages/{area}.{lang}.ts`, English the type. A new area is its two files, its entry in this type and its module
 * `src/lib/admin-words/{stem}.ts` (`docs/audits/bloat-review-2026-11/scripts/admin-words-modules.mjs` writes it); server code reads it as
 * `<AREA>_WORDS[lang]`, several areas with `areaTexts()` (`src/lib/admin-area.ts`), and a client part through `useAdminText()`
 * (bloat review step 2.25: this file holds types only, no table of every area). An area is converted with the screens that show it, and
 * `admin-strings.scan.test.ts` holds what is converted.
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
  consentLook: ConsentLookMessages;
  animation: AnimationMessages;
  heatmaps: HeatmapsMessages;
  recordings: RecordingsMessages;
  companies: CompaniesMessages;
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
  leadScore: LeadScoreMessages;
  flowSplits: FlowSplitsMessages;
  sendAllowance: SendAllowanceMessages;
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
export const SERVER_AREAS = ["carriers", "sandbox", "fiken", "deals", "screens", "storeParts", "backdrops", "animation", "consentLook", "console", "business", "books", "heatmaps", "recordings", "companies", "privacyOfficer", "flows", "automatic", "houseAutopilot", "leadScore", "flowSplits", "sendAllowance", "kit"] as const;

/** An area a client part may read with `useAdminText()`. */
export type ClientArea = Exclude<AdminArea, (typeof SERVER_AREAS)[number]>;

/**
 * Server-only areas a page may hand down to a client part whose English is in its own module already (`useHandedText()`): the builder's
 * shop parts, named in `store-parts.ts`, its backdrops and layers (D534), named in `backdrops.ts`, and its Animation component (D538), named
 * in `animation-words.ts`, and the theme editor's *Cookie popup* card (D883), named in `consent-look-words.ts`. Handed down only where a page draws
 * that part, in another language than English.
 */
export type HandedArea = "storeParts" | "backdrops" | "animation" | "consentLook";

