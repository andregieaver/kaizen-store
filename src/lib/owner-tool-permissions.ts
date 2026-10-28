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
  support_overview: "support:read",
  list_support_conversations: "support:read",
  // Work (PSI AGT-01): Work's screens ask the Settings area's keys (D122).
  work_overview: "settings:read",
  list_work_clients: "settings:read",
  list_work_assignments: "settings:read",
  log_time: "settings:write",
  issue_work_invoice: "settings:write",
  // Order changes and exchanges (PSI AGT-01): the order editor and the return's page are the Orders section's.
  preview_order_change: "orders:read",
  change_order: "orders:write",
  preview_exchange: "orders:read",
  propose_exchange: "orders:write",
  process_exchange: "orders:write",
  // The team and the plan (PSI AGT-01): the Staff and Billing pages are the owner's (`requireOwnerRole`), so are their tools.
  list_staff: "owner",
  invite_staff: "owner",
  change_staff_role: "owner",
  remove_staff: "owner",
  billing_overview: "owner",
  change_plan: "owner",
  end_plan: "owner",
  // Answering (PSI AGT-01): reading a conversation is the inbox's read, a note, a reply and ending it its write.
  get_support_conversation: "support:read",
  add_support_note: "support:write",
  reply_to_support: "support:write",
  end_support_conversation: "support:write",
  // Gift cards (D300 F4): the Gift cards page is the Products section's.
  gift_card_overview: "products:read",
  // Issuing one is the Gift cards page's, with the right to change products (D300 F4).
  issue_gift_card: "products:write",
  reviews_overview: "products:read",
  // Marketing (PSI AGT-01): the Broadcasts and Automations pages are read with `marketing:read`, changed with `marketing:write`; segments
  // and customer tags are the Customers section's.
  list_broadcasts: "marketing:read",
  draft_broadcast: "marketing:write",
  send_broadcast: "marketing:write",
  list_email_automations: "marketing:read",
  switch_email_automation: "marketing:write",
  list_segments: "customers:read",
  list_price_lists: "customers:read",
  tag_customer: "customers:write",
  usage_and_limits: "billing:read",
  // Domains (D315) are a Settings page: read with `settings:read`; buying, renewing, DNS changes and moves are the owner's.
  list_domains: "settings:read",
  check_domain: "settings:read",
  search_domains: "owner",
  buy_domain: "owner",
  renew_domain: "owner",
  set_domain_renewal: "owner",
  list_dns_records: "settings:read",
  change_dns: "owner",
  set_up_email: "owner",
  verify_domain_for: "owner",
  undo_dns_change: "owner",
  plan_domain_move: "owner",
  switch_nameservers: "owner",
  start_dns_move_here: "owner",
  connect_domain: "owner",
  // Looking (the page's `read`)
  store_overview: "owner",
  sales_summary: "analytics:read",
  list_orders: "orders:read",
  get_order: "orders:read",
  pick_list: "orders:read",
  // Shipping (D237): the settings pages are read with `settings:read`, the views of orders to hand over with `orders:read`.
  shipping_overview: "settings:read",
  pickup_orders: "orders:read",
  // Notifications and automation (D238) are Settings pages, read with `settings:read`; a parcel's tracking is the order page's, `orders:read`.
  notification_settings: "settings:read",
  order_rules: "settings:read",
  parcel_tracking: "orders:read",
  // Draft orders (D173) are the Orders section's: read like the Orders page, written with the right to change orders.
  list_draft_orders: "orders:read",
  list_returns: "orders:read",
  explain_return: "orders:read",
  // The privacy log shows no person (counts and dates), and its page needs `customers:read`: so does the tool (D162).
  list_privacy_requests: "customers:read",
  explain_privacy_request: "customers:read",
  list_products: "products:read",
  get_product: "products:read",
  low_stock: "products:read",
  unit_price_gaps: "products:read",
  list_bookings: "bookings:read",
  list_discounts: "marketing:read",
  list_campaigns: "marketing:read",
  list_field_groups: "products:read",
  get_fields: "products:read",
  list_pages: "website:read",
  search_insights: "settings:read",
  // Search merchandising (D324): the Search page's own keys.
  market_price_rules: "settings:read",
  set_market_price_rule: "settings:write",
  // Customs and duties (D343): the Customs and duties page's own key.
  customs_duties: "settings:read",
  // Producer responsibility (D342): the Producer responsibility page's own keys.
  producer_registrations: "settings:read",
  save_producer_registration: "settings:write",
  // Blogs (D341): the Blogs and Comments pages' own keys (articles are the Website area's).
  list_blogs: "website:read",
  blog_comments: "website:read",
  moderate_blog_comment: "website:write",
  schedule_article: "website:write",
  // Changes by the clock (D340): the editor's Schedule and the theme's page ask the Website area's keys.
  list_scheduled_changes: "website:read",
  schedule_site_change: "website:write",
  search_merchandising: "settings:read",
  save_search_synonym: "settings:write",
  save_search_rule: "settings:write",
  delete_search_merchandising: "settings:write",
  // Content types and entries (D326) are the website's, as their pages under Website, Content are.
  list_content_types: "website:read",
  list_entries: "website:read",
  get_entry: "website:read",
  save_entry: "website:write",
  publish_entry: "website:write",
  unpublish_entry: "website:write",
  save_content_type: "website:write",
  setup_progress: "owner",
  // Setting the store up (D308): what the setup wizard and the Company, Languages and Currencies pages leave to the owner is the owner's; the
  // Countries and Shipping pages ask `settings:write`; opening the store is the wizard's, the owner's.
  set_store_details: "owner",
  set_countries: "settings:write",
  set_languages: "owner",
  set_currencies: "owner",
  set_flat_shipping: "settings:write",
  save_shipping_method: "settings:write",
  open_store: "owner",
  // The store's features (D178): reading them is the owner's like the store's overview; switching is the owner's alone, as on the Features page.
  list_features: "owner",
  set_feature: "owner",
  // The store's look (D308): as Design settings asks, reading `website:read` and changing `website:write`.
  list_themes: "website:read",
  try_theme: "website:read",
  add_theme: "website:write",
  make_theme_live: "website:write",
  // The brand and a look of the store's own (D330): reading the brand, keeping it and designing a look only staff see until made live.
  design_look: "website:write",
  get_brand: "website:read",
  set_brand: "website:write",
  make_brand_marks: "website:write",
  // Looks at pages (D310): they read the site and change nothing.
  look_at_page: "website:read",
  look_at_store: "website:read",
  get_page_look: "website:read",
  legal_pages_status: "owner",
  // Web research (D329): reading the web is like reading the marketing figures; keeping notes writes the store's research.
  search_web: "marketing:read",
  read_web_page: "marketing:read",
  list_research_notes: "marketing:read",
  save_research_note: "marketing:write",
  compare_options: "marketing:write",
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
  speed_report: "analytics:read",
  // Reports (D345): read like the Reports page; saving one is `analytics:write`, as the page's Save.
  report_catalogue: "analytics:read",
  run_report: "analytics:read",
  save_report: "analytics:write",
  list_targets: "analytics:read",
  set_target: "analytics:write",
  // Data in and out (D165): product jobs are read like the products page; the tool narrows the kinds to what the member may see (order and customer files are the owner's).
  list_data_jobs: "products:read",
  explain_import_problems: "products:read",
  restock_suggestions: "products:read",
  // Stock (D172): read like the Inventory page (`products:read`), changed with the right to change products.
  stock_levels: "products:read",
  stock_history: "products:read",
  // The redirects and the 404 report are the Website section's (D168): read like its pages, added with the right to change the website.
  redirect_overview: "website:read",
  list_integrations: "settings:read",
  // The tax settings are the owner's alone (D157), like the page they stand in for.
  get_tax_profile: "owner",
  tax_readiness: "owner",
  // Documents hold buyers' details: the list shows none, and reads like the Orders page (`orders:read`); the settings are the owner's (D159).
  list_invoices: "orders:read",
  invoice_readiness: "owner",
  // The VAT, OSS and IOSS reports (D161) are read like the analytics pages they stand beside: figures from documents, nothing personal.
  vat_report: "analytics:read",
  oss_return_data: "analytics:read",
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
  tag_orders: "orders:write",
  archive_orders: "orders:write",
  create_draft_order: "orders:write",
  send_draft_order: "orders:write",
  mark_order_sent: "orders:write",
  cancel_booking: "bookings:write",
  archive_product: "products:write",
  // The catalogue tools (D308, A1) make and change products as the product editor does, which needs `products:write`.
  create_product: "products:write",
  update_product: "products:write",
  set_prices: "products:write",
  set_product_status: "products:write",
  write_product_texts: "products:write",
  list_categories: "products:read",
  update_category: "products:write",
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
  set_backorder: "products:write",
  post_to_slack: "owner",
  draft_experiment: "marketing:write",
  start_experiment: "marketing:write",
  stop_experiment: "marketing:write",
  apply_winner: "marketing:write",
  unpublish_page: "website:write",
  // The website's pages (D308): read with the Pages screen's `website:read`, built, changed and published with its `website:write`.
  get_page: "website:read",
  list_page_builds: "website:read",
  build_page: "website:write",
  edit_page: "website:write",
  publish_page: "website:write",
  // Places, menus and the header and footer (D308): the Pages list's, Menus' and Header and footer's `website` keys; a legal page is the owner's (asked again by the handler).
  set_page_place: "website:write",
  get_menus: "website:read",
  save_menu: "website:write",
  set_header_footer: "website:write",
  draft_header_footer: "website:write",
  draft_store: "website:write",
  use_header_footer: "website:write",
  add_redirect: "website:write",
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
