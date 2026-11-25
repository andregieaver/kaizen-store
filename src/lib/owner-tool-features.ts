/**
 * The store features (D178, `src/lib/store-features.ts`) the AI manager's store tools stand behind: a tool here is offered only while its
 * feature is on, in the assistant (`runTurn()`), and refused by `runOwnerTool()`/`preflightOwnerTool()` and the store's MCP server, so a
 * feature switched off takes its tools with it. A tool not listed is the shop's or the site's own and is always offered. A test holds that every
 * name here is a tool.
 */
import { EXTENSION_NAMES, storeExtensionOn, type ExtensionId } from "./extensions";
import type { OwnerToolName } from "./owner-tools";
import { requirementMet, type FeatureRequirement, type FeatureSource } from "./store-features";
import { requirementLabel } from "./feature-labels";
import { FEATURE_COMMON_EN } from "./feature-common-labels";

const BOOKED: FeatureRequirement = ["appointments", "bookings"];

export const TOOL_FEATURES: Partial<Record<OwnerToolName, FeatureRequirement>> = {
  list_subscriptions: "subscriptions",
  subscription_boxes: "boxes",
  list_bookings: BOOKED,
  cancel_booking: BOOKED,
  booking_resources: BOOKED,
  set_working_hours: "appointments",
  // Several currencies (D178): the Currencies page is hidden while it is off.
  set_currencies: "currencies",
  reviews_overview: "reviews",
  issue_gift_card: "gift_cards",
  get_bonus_program: "bonus",
  set_bonus_program: "bonus",
  adjust_customer_credits: "bonus",
  get_affiliate_program: "referrals",
  set_affiliate_program: "referrals",
  block_affiliate: "referrals",
  // The online shop's own (D178 step 5): orders, products, stock, customers, discounts, campaigns, recommendations, sales analytics and the
  // VAT reports. A website (the shop off) has none of them; orders and returns still open after the sale are handled on their admin pages.
  sales_summary: "shop",
  list_price_lists: "shop",
  list_orders: "shop",
  get_order: "shop",
  pick_list: "shop",
  shipping_overview: "shop",
  set_flat_shipping: "shop",
  save_shipping_method: "shop",
  pickup_orders: "shop",
  notification_settings: "shop",
  order_rules: "shop",
  parcel_tracking: "shop",
  list_draft_orders: "shop",
  list_returns: "shop",
  explain_return: "shop",
  list_products: "shop",
  get_product: "shop",
  unit_price_gaps: "shop",
  low_stock: "shop",
  stock_levels: "shop",
  stock_history: "shop",
  list_transfers: "shop",
  list_purchase_orders: "shop",
  receive_purchase_order: "shop",
  create_purchase_order: "shop",
  list_supplier_orders: "shop",
  answer_supplier_order: "shop",
  list_customer_groups: "shop",
  set_customer_group: "shop",
  set_price_list_prices: "shop",
  set_price_list_buyers: "shop",
  list_loyalty_rewards: "bonus",
  switch_loyalty_reward: "bonus",
  save_loyalty_reward: "bonus",
  set_price_list_scope: "shop",
  set_price_list_breaks: "shop",
  set_price_list_rules: "shop",
  create_transfer: "shop",
  list_discounts: "shop",
  list_campaigns: "shop",
  search_insights: "shop",
  market_price_rules: "countries",
  set_market_price_rule: "countries",
  customs_duties: "shop",
  producer_registrations: "shop",
  save_producer_registration: "shop",
  checkout_questions: "shop",
  save_checkout_question: "shop",
  // Deals (D464) carry their contracts: off, the deals pages and their tools go.
  list_contracts: "sales",
  draft_contract: "sales",
  remind_contract_signer: "sales",
  // The CRM (ecosystem plan E2.5, D713): deals, leads and activities are the Deals feature's; a timeline is every store's.
  list_deals: "sales",
  get_deal: "sales",
  move_deal: "sales",
  list_leads: "sales",
  make_deal_from_lead: "sales",
  crm_today: "sales",
  log_activity: "sales",
  search_merchandising: "shop",
  save_search_synonym: "shop",
  save_search_rule: "shop",
  delete_search_merchandising: "shop",
  get_tax_profile: "shop",
  tax_readiness: "shop",
  list_invoices: "shop",
  invoice_readiness: "shop",
  vat_report: "shop",
  oss_return_data: "shop",
  list_customers: "shop",
  get_customer: "shop",
  cart_reminder_stats: "shop",
  write_cart_reminder: "shop",
  wishlist_insights: "shop",
  list_emails: "shop",
  customer_insights: "shop",
  product_performance: "shop",
  sales_trend: "shop",
  sales_funnel: "shop",
  analytics_overview: "shop",
  profit_overview: "shop",
  explain_change: "shop",
  analytics_alerts: "shop",
  // A rival's offers are held against the store's products and prices (D900 M2).
  list_rivals: "shop",
  read_rival_offer: "shop",
  report_catalogue: "shop",
  run_report: "shop",
  save_report: "shop",
  list_targets: "shop",
  set_target: "shop",
  restock_suggestions: "shop",
  add_order_note: "shop",
  mark_order_sent: "shop",
  tag_orders: "shop",
  archive_orders: "shop",
  create_draft_order: "shop",
  send_draft_order: "shop",
  // Quotes and how prices show (D437): the shop's own.
  set_draft_prices: "shop",
  decline_quote: "shop",
  price_display: "shop",
  set_price_display: "shop",
  set_quote_requests: "shop",
  archive_product: "shop",
  create_product: "shop",
  update_product: "shop",
  set_prices: "shop",
  set_product_status: "shop",
  write_product_texts: "shop",
  list_categories: "shop",
  update_category: "shop",
  refund_order: "shop",
  cancel_order: "shop",
  approve_return: "shop",
  decline_return: "shop",
  create_discount: "shop",
  set_discount_active: "shop",
  create_campaign: "shop",
  set_campaign_active: "shop",
  get_recommendations: "shop",
  set_recommendations: "shop",
  add_recommendation_rule: "shop",
  remove_recommendation_rule: "shop",
  check_recommendations: "shop",
  email_customer: "shop",
  resend_order_email: "shop",
  set_stock: "shop",
  set_backorder: "shop",
};

/** The feature a tool stands behind, or undefined. */
export const toolFeature = (name: string): FeatureRequirement | undefined => (Object.hasOwn(TOOL_FEATURES, name) ? TOOL_FEATURES[name as OwnerToolName] : undefined);

/**
 * The paid extension (D748, `src/lib/extensions.ts`) each of the AI manager's tools is part of: offered only while the account has it, in the
 * assistant, `runOwnerTool()`/`preflightOwnerTool()` and the owner MCP server, as `TOOL_FEATURES` does for a store feature. A test holds that
 * every name here is a tool.
 */
export const TOOL_EXTENSIONS: Partial<Record<OwnerToolName, ExtensionId>> = {
  // A/B tests of pages (D148).
  list_experiments: "ab_testing",
  explain_results: "ab_testing",
  suggest_experiments: "ab_testing",
  draft_experiment: "ab_testing",
  start_experiment: "ab_testing",
  stop_experiment: "ab_testing",
  apply_winner: "ab_testing",
  version_behaviour: "ab_testing",
  // The support desk (D216); the shopper chat is the shop's own.
  support_overview: "support_desk",
  list_support_conversations: "support_desk",
  get_support_conversation: "support_desk",
  add_support_note: "support_desk",
  reply_to_support: "support_desk",
  end_support_conversation: "support_desk",
  carry_out_address_change: "support_desk",
  // Broadcasts, segments and automations (D296 to D298); `switch_email_automation` also switches the shop's cart reminders (D33), so it stays offered, and the automations it switches on do not send without the extension (their job asks `commerce.extension_on()`).
  list_broadcasts: "email_automation",
  draft_broadcast: "email_automation",
  send_broadcast: "email_automation",
  list_segments: "email_automation",
  count_segment: "email_automation",
  save_segment: "email_automation",
  list_email_automations: "email_automation",
  list_flows: "email_automation",
  start_flow: "email_automation",
  create_flow: "email_automation",
  change_flow: "email_automation",
  write_email_automation: "email_automation",
  // The social media manager (D870 S1.6).
  social_report: "social",
  social_plan: "social",
  write_social_posts: "social",
  // Work (D122).
  work_overview: "work",
  list_work_clients: "work",
  list_work_assignments: "work",
  log_time: "work",
  issue_work_invoice: "work",
  // Deals, leads, activities and contracts (D464, D468, D475, D695): also behind the store feature `sales`.
  list_contracts: "deals",
  draft_contract: "deals",
  remind_contract_signer: "deals",
  list_deals: "deals",
  get_deal: "deals",
  move_deal: "deals",
  list_leads: "deals",
  make_deal_from_lead: "deals",
  crm_today: "deals",
  log_activity: "deals",
};

/** The extension a tool is part of, or undefined. */
export const toolExtension = (name: string): ExtensionId | undefined => (Object.hasOwn(TOOL_EXTENSIONS, name) ? TOOL_EXTENSIONS[name as OwnerToolName] : undefined);

/** The store's account has the tool's extension, or it is part of none (a store without facts: every one). */
const extensionMet = (store: FeatureSource, name: string): boolean => {
  const extension = toolExtension(name);
  return !extension || Array.isArray(store) || storeExtensionOn(store as { extensionFacts?: unknown }, extension);
};

/** Whether the store offers a tool: its feature, if any, is on, and its account has its extension, if any. */
export const toolOffered = (store: FeatureSource, name: string): boolean => requirementMet(store, toolFeature(name)) && extensionMet(store, name);

/** What the assistant says of a tool the store does not offer: its feature is off, or its extension is not the account's. */
export function toolFeatureRefusal(name: string, store?: FeatureSource): string {
  const extension = toolExtension(name);
  if (extension && store && !extensionMet(store, name)) return `This tool is part of the ${EXTENSION_NAMES[extension]} extension, which this account does not have.`;
  const feature = toolFeature(name);
  return `${feature ? requirementLabel(feature, FEATURE_COMMON_EN) : "That feature"} is switched off in this store. An owner switches it on under Settings → Features.`;
}
