import type { AdminLang } from "@/lib/admin-lang";
import type { AdminArea, AdminAreaMessages } from "@/lib/admin-text";
import { ANALYTICS_WORDS } from "@/lib/admin-words/analytics";
import { ANALYTICS_EXPORT_WORDS } from "@/lib/admin-words/analytics-export";
import { ANIMATION_WORDS } from "@/lib/admin-words/animation";
import { ASSISTANT_WORDS } from "@/lib/admin-words/assistant";
import { ASSISTANT_BAR_WORDS } from "@/lib/admin-words/assistant-bar";
import { AUTOMATIC_WORDS } from "@/lib/admin-words/automatic";
import { BACKDROPS_WORDS } from "@/lib/admin-words/backdrops";
import { BILLING_WORDS } from "@/lib/admin-words/billing";
import { BLOCKS_WORDS } from "@/lib/admin-words/blocks";
import { BLOCKS_FORM_WORDS } from "@/lib/admin-words/blocks-form";
import { BLOG_WORDS } from "@/lib/admin-words/blog";
import { BLOG_EDITOR_WORDS } from "@/lib/admin-words/blog-editor";
import { BOOKINGS_WORDS } from "@/lib/admin-words/bookings";
import { BOOKS_WORDS } from "@/lib/admin-words/books";
import { BUILDER_WORDS } from "@/lib/admin-words/builder";
import { BUILDER_TEXT_WORDS } from "@/lib/admin-words/builder-text";
import { BUILDER_VERSIONS_WORDS } from "@/lib/admin-words/builder-versions";
import { BUSINESS_WORDS } from "@/lib/admin-words/business";
import { CAPACITY_WORDS } from "@/lib/admin-words/capacity";
import { CARRIERS_WORDS } from "@/lib/admin-words/carriers";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { CONSOLE_WORDS } from "@/lib/admin-words/console";
import { CONTENT_WORDS } from "@/lib/admin-words/content";
import { CUSTOM_REPORTS_WORDS } from "@/lib/admin-words/custom-reports";
import { CUSTOMERS_WORDS } from "@/lib/admin-words/customers";
import { CUSTOMERS_STAFF_WORDS } from "@/lib/admin-words/customers-staff";
import { DEALS_WORDS } from "@/lib/admin-words/deals";
import { DESIGN_WORDS } from "@/lib/admin-words/design";
import { DESIGN_EDITOR_WORDS } from "@/lib/admin-words/design-editor";
import { DISCOUNTS_WORDS } from "@/lib/admin-words/discounts";
import { DOMAINS_WORDS } from "@/lib/admin-words/domains";
import { DRAFTS_WORDS } from "@/lib/admin-words/drafts";
import { EXPERIMENTS_WORDS } from "@/lib/admin-words/experiments";
import { FIELDS_WORDS } from "@/lib/admin-words/fields";
import { FIELDS_EDITOR_WORDS } from "@/lib/admin-words/fields-editor";
import { FIKEN_WORDS } from "@/lib/admin-words/fiken";
import { FINANCE_WORDS } from "@/lib/admin-words/finance";
import { FLOWS_WORDS } from "@/lib/admin-words/flows";
import { FORM_TEMPLATES_WORDS } from "@/lib/admin-words/form-templates";
import { FORMS_WORDS } from "@/lib/admin-words/forms";
import { GIFT_CARDS_WORDS } from "@/lib/admin-words/gift-cards";
import { HEATMAPS_WORDS } from "@/lib/admin-words/heatmaps";
import { HOME_WORDS } from "@/lib/admin-words/home";
import { HOME_DRAFTS_WORDS } from "@/lib/admin-words/home-drafts";
import { HOUSE_AUTOPILOT_WORDS } from "@/lib/admin-words/house-autopilot";
import { LEAD_SCORE_WORDS } from "@/lib/admin-words/lead-score";
import { INVENTORY_WORDS } from "@/lib/admin-words/inventory";
import { INVENTORY_IMPORT_WORDS } from "@/lib/admin-words/inventory-import";
import { INVOICES_WORDS } from "@/lib/admin-words/invoices";
import { KIT_WORDS } from "@/lib/admin-words/kit";
import { LEGAL_WORDS } from "@/lib/admin-words/legal";
import { LOYALTY_WORDS } from "@/lib/admin-words/loyalty";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { MOVING_WORDS } from "@/lib/admin-words/moving";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { NOTIFICATIONS_GOOGLE_WORDS } from "@/lib/admin-words/notifications-google";
import { NOTIFICATIONS_INTEGRATIONS_WORDS } from "@/lib/admin-words/notifications-integrations";
import { NOTIFICATIONS_TOKENS_WORDS } from "@/lib/admin-words/notifications-tokens";
import { NOTIFICATIONS_WORKFLOWS_WORDS } from "@/lib/admin-words/notifications-workflows";
import { OAUTH_WORDS } from "@/lib/admin-words/oauth";
import { ORDER_WORDS } from "@/lib/admin-words/order";
import { ORDERS_WORDS } from "@/lib/admin-words/orders";
import { PAYMENTS_WORDS } from "@/lib/admin-words/payments";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { PLATFORM_COPY_WORDS } from "@/lib/admin-words/platform-copy";
import { PLATFORM_DOCS_GUIDE_WORDS } from "@/lib/admin-words/platform-docs-guide";
import { PLATFORM_LEGAL_WORDS } from "@/lib/admin-words/platform-legal";
import { PLATFORM_REMINDERS_WORDS } from "@/lib/admin-words/platform-reminders";
import { PLATFORM_SITE_WORDS } from "@/lib/admin-words/platform-site";
import { PLATFORM_TOOLS_WORDS } from "@/lib/admin-words/platform-tools";
import { PRIVACY_WORDS } from "@/lib/admin-words/privacy";
import { PRIVACY_OFFICER_WORDS } from "@/lib/admin-words/privacy-officer";
import { PRODUCT_WORDS } from "@/lib/admin-words/product";
import { PRODUCTS_WORDS } from "@/lib/admin-words/products";
import { PRODUCTS_EDITOR_WORDS } from "@/lib/admin-words/products-editor";
import { RECORDINGS_WORDS } from "@/lib/admin-words/recordings";
import { REDIRECTS_WORDS } from "@/lib/admin-words/redirects";
import { REPORTS_WORDS } from "@/lib/admin-words/reports";
import { REPORTS_CAMPAIGNS_WORDS } from "@/lib/admin-words/reports-campaigns";
import { RETURNS_WORDS } from "@/lib/admin-words/returns";
import { REVIEWS_WORDS } from "@/lib/admin-words/reviews";
import { SANDBOX_WORDS } from "@/lib/admin-words/sandbox";
import { SCHEDULES_WORDS } from "@/lib/admin-words/schedules";
import { SCHEDULES_EDITOR_WORDS } from "@/lib/admin-words/schedules-editor";
import { SCREENS_WORDS } from "@/lib/admin-words/screens";
import { SETTINGS_WORDS } from "@/lib/admin-words/settings";
import { SETTINGS_AI_WORDS } from "@/lib/admin-words/settings-ai";
import { SETTINGS_COMPANY_WORDS } from "@/lib/admin-words/settings-company";
import { SETTINGS_FEATURES_WORDS } from "@/lib/admin-words/settings-features";
import { SETTINGS_HOURS_WORDS } from "@/lib/admin-words/settings-hours";
import { SETTINGS_PRICE_RULES_WORDS } from "@/lib/admin-words/settings-price-rules";
import { SETTINGS_PRICES_WORDS } from "@/lib/admin-words/settings-prices";
import { SETTINGS_PRODUCER_WORDS } from "@/lib/admin-words/settings-producer";
import { SETUP_WORDS } from "@/lib/admin-words/setup";
import { SHELL_WORDS } from "@/lib/admin-words/shell";
import { SHIPPING_WORDS } from "@/lib/admin-words/shipping";
import { SIGN_IN_WORDS } from "@/lib/admin-words/sign-in";
import { STAFF_WORDS } from "@/lib/admin-words/staff";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { STORE_PARTS_WORDS } from "@/lib/admin-words/store-parts";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";
import { SUPPORT_SETTINGS_WORDS } from "@/lib/admin-words/support-settings";
import { TAX_WORDS } from "@/lib/admin-words/tax";
import { TAX_REPORTS_WORDS } from "@/lib/admin-words/tax-reports";
import { WEBSITE_WORDS } from "@/lib/admin-words/website";
import { WEBSITE_LIST_WORDS } from "@/lib/admin-words/website-list";
import { WEBSITE_MEDIA_WORDS } from "@/lib/admin-words/website-media";
import { WEBSITE_MENUS_WORDS } from "@/lib/admin-words/website-menus";
import { WEBSITE_PICK_WORDS } from "@/lib/admin-words/website-pick";
import { WEBSITE_STAGING_WORDS } from "@/lib/admin-words/website-staging";
import { WORK_WORDS } from "@/lib/admin-words/work";

/**
 * Every admin area's module, by area name (bloat review step 2.25): test support only, the one table of every area left, so a test can walk
 * them all (`admin-lang.test.ts`). The mapped type makes leaving an area out a compile error. Only test files may import this file.
 */
export const ALL_AREA_WORDS: { [A in AdminArea]: Record<AdminLang, AdminAreaMessages[A]> } = {
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
  leadScore: LEAD_SCORE_WORDS,
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
