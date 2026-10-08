/**
 * The store features (D178, `src/lib/store-features.ts`) the AI manager's store tools stand behind: a tool here is offered only while its
 * feature is on, in the assistant (`runTurn()`), and refused by `runOwnerTool()`/`preflightOwnerTool()` and the store's MCP server, so a
 * feature switched off takes its tools with it. A tool not listed is the shop's or the site's own and is always offered. A test holds that every
 * name here is a tool.
 */
import type { OwnerToolName } from "./owner-tools";
import { requirementLabel, requirementMet, type FeatureRequirement, type FeatureSource } from "./store-features";

const BOOKED: FeatureRequirement = ["appointments", "bookings"];

export const TOOL_FEATURES: Partial<Record<OwnerToolName, FeatureRequirement>> = {
  list_subscriptions: "subscriptions",
  subscription_boxes: "boxes",
  list_bookings: BOOKED,
  cancel_booking: BOOKED,
  get_bonus_program: "bonus",
  set_bonus_program: "bonus",
  adjust_customer_credits: "bonus",
  get_affiliate_program: "referrals",
  set_affiliate_program: "referrals",
  block_affiliate: "referrals",
  // The online shop's own (D178 step 5): orders, products, stock, customers, discounts, campaigns, recommendations, sales analytics and the
  // VAT reports. A website (the shop off) has none of them; orders and returns still open after the sale are handled on their admin pages.
  sales_summary: "shop",
  list_orders: "shop",
  get_order: "shop",
  pick_list: "shop",
  list_draft_orders: "shop",
  list_returns: "shop",
  explain_return: "shop",
  list_products: "shop",
  get_product: "shop",
  unit_price_gaps: "shop",
  low_stock: "shop",
  stock_levels: "shop",
  stock_history: "shop",
  list_discounts: "shop",
  list_campaigns: "shop",
  search_insights: "shop",
  get_tax_profile: "shop",
  tax_readiness: "shop",
  list_invoices: "shop",
  invoice_readiness: "shop",
  vat_report: "shop",
  oss_return_data: "shop",
  list_customers: "shop",
  get_customer: "shop",
  cart_reminder_stats: "shop",
  wishlist_insights: "shop",
  list_emails: "shop",
  customer_insights: "shop",
  product_performance: "shop",
  sales_trend: "shop",
  sales_funnel: "shop",
  analytics_overview: "shop",
  explain_change: "shop",
  analytics_alerts: "shop",
  restock_suggestions: "shop",
  add_order_note: "shop",
  mark_order_sent: "shop",
  tag_orders: "shop",
  archive_orders: "shop",
  create_draft_order: "shop",
  send_draft_order: "shop",
  archive_product: "shop",
  refund_order: "shop",
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

/** Whether the store offers a tool: no feature, or its feature is on. */
export const toolOffered = (store: FeatureSource, name: string): boolean => requirementMet(store, toolFeature(name));

/** What the assistant says of a tool whose feature is off. */
export function toolFeatureRefusal(name: string): string {
  const feature = toolFeature(name);
  return `${feature ? requirementLabel(feature) : "That feature"} is switched off in this store. An owner switches it on under Settings → Features.`;
}
