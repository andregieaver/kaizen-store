/**
 * What a member's role must hold to use each of the AI manager's store tools (wave 1, 1f, docs/wave-1-trust.md 2.7.3): one exhaustive table, so a
 * tool added to `OWNER_TOOLS` without a permission is a compile error. The key is the one of the admin page the tool stands in for: a tool that
 * looks at orders needs `orders:read` like the Orders page, one that changes a price or stock `products:write`, and what only the owner may do in
 * the admin (payments, the plan, the AI and integrations settings, the bonus and referral programs' rules, the recommendations' settings) the
 * `owner` key. A tool that summarises across areas (the store's overview and check-up, the setup list) is the owner's too: it would show a member
 * what their role keeps from them.
 *
 * The assistant itself is still the owner's alone in this wave (`/assistant` needs `owner`), so in production the check always passes; it holds
 * for the day it opens to staff, and the store's MCP server (`/api/mcp`) asks it as well. `runOwnerTool()` checks before a handler runs, and
 * `preflightOwnerTool()` before a gated change is kept for a yes, so nothing a role may not do is ever waiting for an approval.
 */
import type { OwnerToolName } from "./owner-tools";
import { AREA_LABELS, can, type Area, type PermissionHolder, type PermissionKey } from "./permissions";

export const TOOL_PERMISSIONS: Record<OwnerToolName, PermissionKey> = {
  // Looking (the page's `read`)
  store_overview: "owner",
  sales_summary: "analytics:read",
  list_orders: "orders:read",
  get_order: "orders:read",
  list_returns: "orders:read",
  explain_return: "orders:read",
  list_products: "products:read",
  get_product: "products:read",
  low_stock: "products:read",
  list_bookings: "bookings:read",
  list_discounts: "marketing:read",
  list_campaigns: "marketing:read",
  list_field_groups: "products:read",
  get_fields: "products:read",
  list_pages: "website:read",
  search_insights: "settings:read",
  setup_progress: "owner",
  store_checkup: "owner",
  list_customers: "customers:read",
  get_customer: "customers:read",
  list_subscriptions: "orders:read",
  cart_reminder_stats: "marketing:read",
  wishlist_insights: "customers:read",
  list_emails: "orders:read",
  subscription_boxes: "orders:read",
  customer_insights: "analytics:read",
  product_performance: "analytics:read",
  sales_trend: "analytics:read",
  sales_funnel: "analytics:read",
  analytics_overview: "analytics:read",
  explain_change: "analytics:read",
  analytics_alerts: "analytics:read",
  restock_suggestions: "products:read",
  list_integrations: "settings:read",
  // The tax settings are the owner's alone (D157), like the page they stand in for.
  get_tax_profile: "owner",
  tax_readiness: "owner",
  ai_usage: "owner",
  get_recommendations: "marketing:read",
  check_recommendations: "marketing:read",
  get_bonus_program: "marketing:read",
  get_affiliate_program: "marketing:read",
  list_experiments: "marketing:read",
  explain_results: "marketing:read",
  suggest_experiments: "marketing:read",
  // Changing (the page's `write`, or the owner's)
  add_order_note: "orders:write",
  mark_order_sent: "orders:write",
  cancel_booking: "bookings:write",
  archive_product: "products:write",
  refund_order: "orders:write",
  approve_return: "orders:write",
  decline_return: "orders:write",
  create_discount: "marketing:write",
  set_discount_active: "marketing:write",
  create_campaign: "marketing:write",
  set_campaign_active: "marketing:write",
  set_recommendations: "owner",
  add_recommendation_rule: "marketing:write",
  remove_recommendation_rule: "marketing:write",
  set_bonus_program: "owner",
  adjust_customer_credits: "customers:write",
  set_affiliate_program: "owner",
  block_affiliate: "marketing:write",
  create_field_group: "products:write",
  set_fields: "products:write",
  email_customer: "customers:write",
  resend_order_email: "orders:write",
  set_stock: "products:write",
  post_to_slack: "owner",
  draft_experiment: "marketing:write",
  start_experiment: "marketing:write",
  stop_experiment: "marketing:write",
  apply_winner: "marketing:write",
  unpublish_page: "website:write",
};

/** The key a tool needs, or null for a name that is no store tool. */
export const toolKey = (name: string): PermissionKey | null => (Object.hasOwn(TOOL_PERMISSIONS, name) ? TOOL_PERMISSIONS[name as OwnerToolName] : null);

/** Whether the holder may use the tool; an unknown tool is nobody's. */
export function mayUseTool(holder: PermissionHolder, name: string): boolean {
  const key = toolKey(name);
  return key !== null && can(holder, key);
}

/** What the assistant says when a role may not use a tool: the area it belongs to, or that it is the owner's. */
export function toolRefusal(name: string): string {
  const key = toolKey(name);
  if (!key || key === "owner") return "I can't do that for you: only an owner can.";
  const area = key.split(":")[0] as Area;
  return `I can't do that for you: your role has no access to ${AREA_LABELS[area].toLowerCase()}.`;
}
