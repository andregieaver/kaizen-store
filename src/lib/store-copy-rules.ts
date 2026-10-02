/**
 * What duplicating a store (D129) does with each table that belongs to a store: the audit behind
 * `commerce.duplicate_store()`, `copy_customers()`, `copy_orders()` and the media phase (`docs/store-copy.md`).
 * Pure, so the tests and the docs read it; `src/db/commerce.test.ts` fails when a table with a `store_id` column
 * is missing here (or a rule names a table that is gone), so a new store-owned table forces a decision.
 *
 * - `settings`: always copied (the store's set-up: everything but secrets and other people's rights).
 * - `catalogue`: copied with the products chosen (and, for field values, with the thing they belong to).
 * - `pages`: copied with the pages and posts chosen.
 * - `people`: copied when customers are (shoppers only).
 * - `orders`: copied when order history is (read-only).
 * - `derived`: rebuilt by code or triggers, never copied as it is.
 * - `never`: stays with the original, with the reason.
 */
export type CopyGroup = "settings" | "catalogue" | "pages" | "people" | "orders" | "never" | "derived";
export type CopyRule = { group: CopyGroup; note: string };

export const COPY_GROUPS: Record<CopyGroup, { label: string; summary: string }> = {
  settings: { label: "Settings", summary: "Always copied, but for secrets and other people's rights." },
  catalogue: { label: "Products", summary: "Copied with the products chosen." },
  pages: { label: "Pages and posts", summary: "Copied with the pages and posts chosen." },
  people: { label: "Customers", summary: "Copied when customers are, as shoppers only." },
  orders: { label: "Order history", summary: "Copied when orders are, as read-only history." },
  derived: { label: "Rebuilt", summary: "Made again by the new store's own code and jobs." },
  never: { label: "Left behind", summary: "Never copied." },
};

const settings = (note: string): CopyRule => ({ group: "settings", note });
const catalogue = (note: string): CopyRule => ({ group: "catalogue", note });
const people = (note: string): CopyRule => ({ group: "people", note });
const orders = (note: string): CopyRule => ({ group: "orders", note });
const derived = (note: string): CopyRule => ({ group: "derived", note });
const never = (note: string): CopyRule => ({ group: "never", note });

export const COPY_RULES: Record<string, CopyRule> = {
  // Settings ---------------------------------------------------------------------------------------------------
  appointment_settings: catalogue("How a product is booked; goes with its product."),
  booking_resources: settings(
    "Staff, rooms and rental items (a host's stay with the original; a calendar's secret address is made again).",
  ),
  bonus_settings: settings("The bonus program's rules (D130): percentages, waits and expiry; balances are not copied."),
  affiliate_settings: settings("The store's referral program's rules (D131): the friend's discount, the reward, limits and cookie days; its customers' links and earnings are not copied."),
  booking_seasons: catalogue("A stay's or rental's seasonal prices; go with the product."),
  campaigns: settings(
    "Offers (D114); one for products that were not copied is switched off, a gift of a product not copied is left out.",
  ),
  cart_reminder_steps: settings("The cart reminder mails' steps (their discount code is the copy of it)."),
  recommendation_settings: never("A new store starts with recommendations off (D139); the owner switches them on and sets the cap."),
  recommendation_rules: never("Goes-with, never-with and hidden products (D139) name the original's products; the new store's owner sets its own."),
  recommendation_events: never("A log of what the original's shoppers did with recommendations (D139)."),
  experiments: never("A/B tests of the original's pages and what they measured (D148): a copy starts with none."),
  experiment_variants: never("The versions of the original's tests (D148)."),
  experiment_exposures: never("Who saw which version in the original's tests (D148)."),
  experiment_events: never("What visitors did in the original's tests (D148)."),
  experiment_carts: never("Which visitor a cart of the original belonged to (D148)."),
  recommendation_adds: never("Recommended products put in the original's carts (D139)."),
  chat_agents: settings(
    "The chat agent's setup (its AI provider is not copied, so it stays off until the site has one).",
  ),
  cookie_notes: settings("What the owner said about cookies a scan found."),
  customer_companies: settings("Company account definitions (D108); their members are customers."),
  customer_tiers: settings("Customer groups and their discounts (D108)."),
  delivery_schedules: settings("Subscription boxes' delivery days (lists and deliveries are not copied)."),
  discount_codes: settings("Codes, with the products they name that were copied; used counts start again."),
  economic_operators: settings("Manufacturers and responsible persons (product safety)."),
  field_groups: settings("Custom field groups (D118); category and tag ids in their rules are the copies'."),
  inventory_locations: settings("Stock locations."),
  knowledge_documents: settings("Documents the owner gave the chat agent (they are cut into chunks again)."),
  markets: settings("The countries the store sells to, and their currencies and languages."),
  menus: settings("Menus (D85), without links to products that were not copied."),
  payment_methods: settings("Which payment methods are switched on per market; never credentials."),
  payment_providers: settings("The provider's switches (on, invoices for orders); the new store starts in test mode."),
  producer_registrations: settings("Producer registrations (packaging, electrical, …) of the same business."),
  saved_parts: settings(
    "The store's saved rows, columns and components, as private ones (what was shared stays the original's to share).",
  ),
  shipping_rates: settings("Flat shipping per market."),
  store_currencies: settings("The currencies the store shows and their rates."),
  store_locations: settings("Shop, pickup and office addresses and hours."),
  store_themes: settings("Saved design themes."),
  template_activations: settings("Which templates are switched on for the store."),
  terms: settings("Categories and tags of pages, posts and products: the store's structure, so all come."),
  page_roles: settings("Which page is the store's blog, search, 404 and working pages (D112, D113)."),

  // Catalogue --------------------------------------------------------------------------------------------------
  field_values: catalogue(
    "What was entered in custom fields: for the products, variants, pages, posts and categories copied, and the store's own (settings); customers' and orders' with them (people, orders).",
  ),
  inventory_levels: catalogue("Stock on hand per variant and location; nothing is reserved."),
  prices: catalogue(
    "The current price of each variant, as a new price (no history, so no reduction the copy never made).",
  ),
  product_media: catalogue("A product's pictures (the media phase copies the files into the new store's library)."),
  product_resources: catalogue("Which staff or rooms a product is booked with."),
  product_schemes: catalogue("Producer schemes a product falls under."),
  product_terms: catalogue("A product's categories and tags."),
  product_translations: catalogue("Product titles and texts in every language."),
  product_variants: catalogue("Variants, with their pictures and options."),
  products: catalogue("Not archived products; a download whose files stay behind waits as a draft."),
  selling_plans: catalogue("A product's subscription plans (no customer's subscription is copied)."),

  // Pages ------------------------------------------------------------------------------------------------------
  pages: {
    group: "pages",
    note: "Pages and posts chosen, draft and published; headers, footers and product layouts are settings and always come.",
  },

  // People -----------------------------------------------------------------------------------------------------
  customers: people(
    "Shoppers: contact details, address, group and company; never a password, session, consent or picture.",
  ),
  email_opt_outs: people("People who unsubscribed stay unsubscribed."),

  // Orders -----------------------------------------------------------------------------------------------------
  order_events: orders("Only one `copied` event is written; the original's history stays behind."),
  order_lines: orders("The order's lines as sold, with their product and plan where those were copied."),
  orders: orders("Read-only history numbered C-{original}; not orders still waiting for payment."),

  // Derived ----------------------------------------------------------------------------------------------------
  field_search: derived(
    "What keyword search reads of fields; copied with the products and rebuilt when they are saved.",
  ),
  knowledge_chunks: derived("The chat agent's knowledge, cut from pages and documents again."),
  media: derived("The library: the media phase adds every file the copied content points at (copied within Storage)."),
  media_embeddings: derived("Search by meaning of pictures; made again from alt texts."),
  product_embeddings: derived("Search by meaning of products; made again by the new store's own AI."),
  search_cache: derived("Cached search vectors and filters; refilled by use."),

  // Never ------------------------------------------------------------------------------------------------------
  abandoned_checkouts: never("Carts left behind by shoppers, with their emails."),
  abandoned_plan_checkouts: never("Plan checkouts of accounts."),
  access_requests: never("Sign-up requests belong to the platform."),
  bonus_allocations: never("What each use of credits took from which grant: part of a customer's ledger (D130)."),
  bonus_entries: never("Customers' bonus credits (D130) are their balance with the original store, like their orders' payments."),
  affiliates: never("Customers' referral codes (D131) belong to the original store's customers; a copied customer makes theirs again when they open Refer a friend."),
  affiliate_attributions: never("Which order came through whose link, and what it earned (D131), is history of the original store: a copied order never carries a referral."),
  referrals: never("Kaizen's referral program (D131) is the platform's: a store referred by a link stays so, and a copy is not a new referral."),
  referral_visits: never("Counts of visits to referral links by day and code (D131), with nothing about the visitor; they stay where they were counted."),
  ai_providers: never("The owner's own AI keys are secrets."),
  ai_usage: never("A log of the original's AI use."),
  assistant_approvals: never("The AI manager's conversations belong to the account and the store they happened in."),
  assistant_conversations: never(
    "The AI manager's conversations belong to the account and the store they happened in.",
  ),
  assistant_memories: never("The AI manager's memories are personal to the account."),
  assistant_messages: never("The AI manager's conversations belong to the account and the store they happened in."),
  audit_log: never("The original's audit trail."),
  bookings: never("Booked times are the original's customers'; copied orders have no booking effect."),
  calendar_feeds: never("Other sites' iCal addresses hold secrets and would be synced twice."),
  cart_lines: never("Shoppers' carts."),
  carts: never("Shoppers' carts."),
  delivery_quotes: never("What a carrier offered a shopper's cart."),
  chat_usage: never("Rate-limit counters."),
  checkout_accounts: never("Passwords chosen at checkout."),
  company_invites: never("Invitations hold tokens for the original."),
  consents: never("The consent log is evidence for the original site."),
  cookie_scans: never("Scan results of the original site; the new store scans its own."),
  page_replications: never("Jobs that copied another website's page for the original store; their drafts are pages and copied as pages."),
  credit_notes: never("Accounting documents with gap-free numbers of the original."),
  customer_codes: never("Sign-in codes."),
  customer_sessions: never("Sessions."),
  customer_sign_in_links: never("Sign-in links."),
  document_series: never("Invoice, credit note, order and Work numbering start again in the new store."),
  email_messages: never("A log of the original's emails."),
  form_submissions: never("What visitors wrote in forms is personal data of the original."),
  google_places: never("Holds an API key."),
  shipping_carriers: never("Holds the original's agreements and API keys with its carriers."),
  host_commissions: never("Hosts stay with the original."),
  host_stripe_accounts: never("Stripe accounts are never copied."),
  host_tax_details: never("Hosts' tax details are theirs."),
  hosts: never("Hosts are other people with their own access to the original."),
  idempotency_keys: never("Request de-duplication."),
  integration_deliveries: never("The queue and log of the original's webhooks."),
  inventory_reservations: never("Stock held for carts and checkouts; copied orders reserve nothing."),
  invoices: never("Invoices are accounting documents of the original."),
  order_downloads: never("Download links carry tokens for the original's files."),
  page_redirects: never("Old addresses of the original's pages."),
  payment_credentials: never("Payment keys are secrets and are the store's own."),
  payments: never("Copied orders have no payments."),
  product_files: never("Download files stay with the original (their products wait as drafts)."),
  refunds: never("Copied orders have no refunds."),
  resource_blocks: never("Closures and blocks from iCal feeds belong to the original's calendar."),
  return_lines: never("Returns are processes of the original."),
  returns: never("Returns are processes of the original."),
  search_clicks: never("A log of the original's searches."),
  search_queries: never("A log of the original's searches."),
  shipments: never("Copied orders have no shipments."),
  standing_deliveries: never("No subscription box list is copied, so nobody is delivered to twice."),
  standing_order_lines: never("No subscription box list is copied, so nobody is delivered to twice."),
  standing_orders: never("No subscription box list is copied, so nobody is delivered to twice."),
  store_billing: never("The plan and billing belong to the original."),
  store_domains: never("A domain belongs to one store."),
  store_integrations: never("Webhook addresses are secrets."),
  store_members: never("Only the person copying owns the new store."),
  stripe_accounts: never("Stripe accounts are never copied; the new store connects its own."),
  subscription_lines: never("No customer's subscription is copied, so nobody is billed twice."),
  subscriptions: never("No customer's subscription is copied, so nobody is billed twice."),
  webhook_events: never("A log of the original's payment events."),
  wishlist_cart_adds: never("Shoppers' wish lists."),
  wishlist_items: never("Shoppers' wish lists."),
  wishlists: never("Shoppers' wish lists."),
  withdrawal_request_lines: never("Withdrawals are processes of the original."),
  withdrawal_requests: never("Withdrawals are processes of the original."),
  work_assignments: never("Work (D122) is the owner's own bookkeeping."),
  work_clients: never("Work (D122) is the owner's own bookkeeping."),
  work_credit_notes: never("Work (D122) is the owner's own bookkeeping."),
  work_events: never("Work (D122) is the owner's own bookkeeping."),
  work_invoice_lines: never("Work (D122) is the owner's own bookkeeping."),
  work_invoice_payments: never("Work (D122) is the owner's own bookkeeping."),
  work_invoices: never("Work (D122) is the owner's own bookkeeping."),
  work_recurring_invoices: never("Work (D122) is the owner's own bookkeeping."),
  work_settings: never("Work (D122) is the owner's own bookkeeping."),
  work_tasks: never("Work (D122) is the owner's own bookkeeping."),
  work_time_entries: never("Work (D122) is the owner's own bookkeeping."),
  work_timers: never("Work (D122) is the owner's own bookkeeping."),
};

/** The tables of a group, by name. */
export const copyTables = (group: CopyGroup): string[] =>
  Object.entries(COPY_RULES)
    .filter(([, rule]) => rule.group === group)
    .map(([table]) => table)
    .sort();

/**
 * The tables that could carry a secret or another person's right, which must never be copied: the test holds these
 * to `never` whatever else changes.
 */
export const SECRET_TABLES = [
  "payment_credentials",
  "stripe_accounts",
  "store_domains",
  "store_integrations",
  "ai_providers",
  "google_places",
  "shipping_carriers",
  "store_billing",
  "store_members",
  "customer_sessions",
  "customer_codes",
  "customer_sign_in_links",
  "checkout_accounts",
  "company_invites",
  "consents",
] as const;
