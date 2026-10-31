/**
 * Why each kind of personal data is processed, and on what legal basis (PSI REG-01; GDPR Art. 30(1)(b), Art. 6(1)): every entry of the
 * personal-data register (`PERSONAL_DATA`, `src/lib/personal-data.ts`) names one purpose here, and each purpose one basis. Pure.
 *
 * The bases are proposals for the lawyer, not legal advice: each says why it was chosen, and `review` marks the ones a lawyer should look at
 * first. For a shopper's data the store is the controller and Kaizena Flow its processor (the DPA), so a shopper purpose is the store's
 * purpose; for owners', staff's, hosts' and applicants' data Kaizena Flow is the controller. `personal-purposes.test.ts` holds every
 * register entry to a purpose, and every purpose to at least one entry.
 */

/** GDPR Art. 6(1): (a) consent, (b) contract, (c) legal obligation, (f) legitimate interests. (d) and (e) are not used. */
export type LawfulBasis = "a" | "b" | "c" | "f";

export const BASIS_TEXT: Record<LawfulBasis, string> = {
  a: "Art. 6(1)(a): consent",
  b: "Art. 6(1)(b): a contract with the person, or steps they asked for before one",
  c: "Art. 6(1)(c): a legal obligation",
  f: "Art. 6(1)(f): legitimate interests, weighed against the person's",
};

export type Purpose = {
  /** What the data is used for, in one sentence a person can read. */
  what: string;
  basis: LawfulBasis;
  /** Why this basis, and the law it rests on where it is an obligation. */
  why: string;
  /** Who decides the purpose: the store (Kaizena Flow processes for it) or Kaizena Flow itself. */
  controller: "store" | "platform";
  /** A basis a lawyer should look at first: a judgement, not a clear case. */
  review?: true;
};

export const PURPOSES = {
  orders: {
    what: "Selling, paying for, delivering and following up an order, a booking or a subscription the person placed.",
    basis: "b",
    why: "The order is the contract; delivery, payment and its follow-up are needed to perform it.",
    controller: "store",
  },
  bookkeeping: {
    what: "Keeping invoices, credit notes, payments and the records bookkeeping and tax law require.",
    basis: "c",
    why: "Bookkeeping and VAT law (for Norway bokføringsloven § 13; the retention rules name each country's source).",
    controller: "store",
  },
  consumer_rights: {
    what: "Handling withdrawals, returns and complaints the person makes under consumer law.",
    basis: "c",
    why: "Directive 2011/83/EU (withdrawal, Art. 9–16) and the sale-of-goods rules oblige the trader to handle them.",
    controller: "store",
  },
  account: {
    what: "The person's account with the store: signing in, saved addresses, wish lists and what they keep there.",
    basis: "b",
    why: "The account is a service the person asked for when they made it.",
    controller: "store",
  },
  programmes: {
    what: "Loyalty credit, gift cards, referrals, affiliates and creators the person joined or holds.",
    basis: "b",
    why: "Each is a scheme the person joined, or a card they hold, on its terms.",
    controller: "store",
  },
  business_customers: {
    what: "A company's purchasing: its buyers, locations, terms and work billed to it.",
    basis: "b",
    why: "The contract is with the company; its contact people are processed to perform it.",
    controller: "store",
    review: true,
  },
  marketing: {
    what: "Newsletters, automations and messages the person signed up for, and keeping their choices.",
    basis: "a",
    why: "Email marketing needs consent (Directive 2002/58/EC Art. 13; for Norway markedsføringsloven § 15), recorded with its wording; a customer's own similar products are the exception those rules allow.",
    controller: "store",
  },
  consent_records: {
    what: "Proving what the person agreed to or refused, and honouring an opt-out.",
    basis: "c",
    why: "GDPR Art. 7(1): the controller must be able to show consent was given; an opt-out must be kept to be respected.",
    controller: "store",
  },
  contributions: {
    what: "Reviews, comments and pictures the person chose to publish on the store.",
    basis: "f",
    why: "The store's interest in showing customers' reviews, which the person wrote to be shown; they can remove it.",
    controller: "store",
    review: true,
  },
  support: {
    what: "Answering the person's questions, messages and forms.",
    basis: "f",
    why: "The store's interest in answering the person who wrote; where it is about an order, Art. 6(1)(b) also applies.",
    controller: "store",
  },
  analytics: {
    what: "Understanding how the store is used (visits, searches, tests, recommendations) without naming anyone.",
    basis: "f",
    why: "Pseudonymous and kept short; where the store's cookie notice asks for consent first, the basis is Art. 6(1)(a).",
    controller: "store",
    review: true,
  },
  security: {
    what: "Keeping sign-ins, payments and the service safe: codes, sessions, retries and the record of who did what.",
    basis: "f",
    why: "The interest in a secure service (GDPR Art. 32 and recital 49).",
    controller: "store",
  },
  privacy_rights: {
    what: "Answering requests to see, correct, move or erase data.",
    basis: "c",
    why: "GDPR Art. 12–22 oblige the controller to answer, and to show it did.",
    controller: "store",
  },
  integrations: {
    what: "Passing order data to the services the store connected (accounting, delivery, its own systems).",
    basis: "b",
    why: "Needed to perform the order, or the store's interest in its own tools (Art. 6(1)(f)) where it is not.",
    controller: "store",
    review: true,
  },
  platform_service: {
    what: "Providing Kaizena Flow to the people who run a store: their accounts, stores, settings and the AI manager's work for them.",
    basis: "b",
    why: "The terms of service between Kaizena Flow and the store's owner; staff are given access by the owner under them.",
    controller: "platform",
  },
  platform_billing: {
    what: "Kaizena Flow's own invoices, payouts and tax details for owners and hosts.",
    basis: "c",
    why: "Bookkeeping law for Kaizena Flow's own records, and the reporting rules for platforms (DAC7, Directive (EU) 2021/514).",
    controller: "platform",
  },
  platform_applicants: {
    what: "Applications and sign-ups to open a store, and people who asked to hear about incidents.",
    basis: "b",
    why: "Steps the person asked for before a contract (opening a store), or a service they asked for (status emails).",
    controller: "platform",
  },
  illegal_content: {
    what: "Notices of illegal content and their decisions.",
    basis: "c",
    why: "Regulation (EU) 2022/2065 (DSA) Art. 16–17 oblige a hosting service to take, decide and answer notices.",
    controller: "platform",
  },
} as const satisfies Record<string, Purpose>;

export type PurposeKey = keyof typeof PURPOSES;

/** Each register entry's purpose, by its table (`storage:{bucket}` for a bucket). */
export const PURPOSE_OF: Readonly<Record<string, PurposeKey>> = {
  customers: "account",
  "storage:avatars": "account",
  orders: "orders",
  order_lines: "orders",
  payments: "bookkeeping",
  payout_lines: "bookkeeping",
  payment_disputes: "orders",
  refunds: "bookkeeping",
  shipments: "orders",
  shipment_tracking: "orders",
  order_rule_runs: "orders",
  bookings: "orders",
  shipment_lines: "orders",
  order_edits: "orders",
  order_edit_lines: "orders",
  unsent_closures: "orders",
  order_payment_terms: "orders",
  order_terms: "consumer_rights",
  legal_snapshots: "consumer_rights",
  order_events: "orders",
  order_downloads: "orders",
  order_tags: "orders",
  draft_orders: "orders",
  draft_order_lines: "orders",
  inventory_reservations: "orders",
  host_commissions: "platform_billing",
  document_deliveries: "bookkeeping",
  invoices: "bookkeeping",
  credit_notes: "bookkeeping",
  "storage:documents": "bookkeeping",
  "storage:exports": "privacy_rights",
  withdrawal_requests: "consumer_rights",
  withdrawal_request_lines: "consumer_rights",
  returns: "consumer_rights",
  return_exchanges: "consumer_rights",
  return_exchange_lines: "consumer_rights",
  return_lines: "consumer_rights",
  withdrawal_attempts: "security",
  subscriptions: "orders",
  subscription_lines: "orders",
  standing_orders: "orders",
  standing_order_lines: "orders",
  standing_deliveries: "orders",
  checkout_accounts: "account",
  customer_sessions: "security",
  customer_codes: "security",
  customer_sign_in_links: "security",
  wishlists: "account",
  wishlist_items: "account",
  wishlist_cart_adds: "account",
  carts: "orders",
  cart_lines: "orders",
  cart_gift_cards: "orders",
  delivery_quotes: "orders",
  abandoned_checkouts: "marketing",
  gift_cards: "programmes",
  gift_card_entries: "programmes",
  discount_code_items: "programmes",
  bonus_entries: "programmes",
  bonus_allocations: "programmes",
  affiliates: "programmes",
  affiliate_attributions: "programmes",
  referral_visits: "analytics",
  creators: "programmes",
  creator_attributions: "programmes",
  creator_commissions: "programmes",
  customer_companies: "business_customers",
  company_location_buyers: "business_customers",
  company_invites: "business_customers",
  email_messages: "orders",
  marketing_subscribers: "marketing",
  customer_addresses: "account",
  signup_incentives: "marketing",
  customer_notes: "support",
  customer_tags: "marketing",
  broadcast_recipients: "marketing",
  automation_sends: "marketing",
  product_reviews: "contributions",
  review_pictures: "contributions",
  "storage:review-pictures": "contributions",
  review_requests: "marketing",
  stock_requests: "marketing",
  marketing_consent_events: "consent_records",
  email_opt_outs: "consent_records",
  blog_comments: "contributions",
  form_submissions: "support",
  consents: "consent_records",
  visits: "analytics",
  product_views: "analytics",
  experiment_exposures: "analytics",
  experiment_events: "analytics",
  experiment_carts: "analytics",
  search_queries: "analytics",
  search_clicks: "analytics",
  recommendation_events: "analytics",
  recommendation_adds: "analytics",
  chat_usage: "security",
  support_conversations: "support",
  support_inbound_emails: "support",
  support_messages: "support",
  support_actions: "support",
  field_values: "orders",
  vat_checks: "bookkeeping",
  api_idempotency_keys: "security",
  webhook_events: "orders",
  integration_deliveries: "integrations",
  privacy_requests: "privacy_rights",
  idempotency_keys: "security",
  work_clients: "business_customers",
  work_assignments: "business_customers",
  work_credit_notes: "bookkeeping",
  work_events: "business_customers",
  work_invoices: "bookkeeping",
  work_recurring_invoices: "business_customers",
  work_time_entries: "business_customers",
  accounts: "platform_service",
  push_subscriptions: "platform_service",
  status_subscribers: "platform_applicants",
  content_reports: "illegal_content",
  access_requests: "platform_applicants",
  abandoned_plan_checkouts: "platform_applicants",
  accessibility_settings: "platform_service",
  assistant_memories: "platform_service",
  assistant_messages: "platform_service",
  assistant_notices: "platform_service",
  assistant_skills: "platform_service",
  store_drafts: "platform_service",
  dream_runs: "platform_service",
  assistant_follow_ups: "platform_service",
  assistant_goals: "platform_service",
  assistant_plans: "platform_service",
  autopilot_reports: "platform_service",
  autopilot_events: "platform_service",
  autopilot_reviews: "platform_service",
  brand_profiles: "platform_service",
  research_notes: "platform_service",
  research_sources: "platform_service",
  legal_ai_settings: "platform_service",
  legal_ai_writes: "platform_service",
  page_looks: "platform_service",
  assistant_plan_steps: "platform_service",
  audit_log: "security",
  booking_resources: "platform_service",
  economic_operators: "platform_service",
  host_stripe_accounts: "platform_billing",
  host_tax_details: "platform_billing",
  hosts: "platform_service",
  blog_authors: "platform_service",
  kaizen_life_links: "platform_service",
  wordpress_connections: "platform_service",
  referral_entries: "platform_billing",
  return_settings: "platform_service",
  store_locations: "platform_service",
  store_roles: "platform_service",
  stores: "platform_service",
  domain_purchases: "platform_billing",
  domain_registrants: "platform_service",
  products: "platform_service",
};

/** One line of the record of processing (Art. 30(1)): a purpose, its basis, whose data, which tables and which retention rules end it. */
export type ProcessingRecordRow = {
  purpose: PurposeKey;
  what: string;
  basis: LawfulBasis;
  basisText: string;
  why: string;
  controller: Purpose["controller"];
  review: boolean;
  subjects: string[];
  tables: string[];
  retention: string[];
};

/** The record of processing from the register: one row per purpose, in `PURPOSES` order, from the entries given. */
export function processingRecord(
  entries: readonly { table: string; subject: string; until?: string }[],
): ProcessingRecordRow[] {
  return (Object.keys(PURPOSES) as PurposeKey[]).map((key) => {
    const purpose: Purpose = PURPOSES[key];
    const mine = entries.filter((e) => PURPOSE_OF[e.table] === key);
    const unique = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
    return {
      purpose: key,
      what: purpose.what,
      basis: purpose.basis,
      basisText: BASIS_TEXT[purpose.basis],
      why: purpose.why,
      controller: purpose.controller,
      review: purpose.review === true,
      subjects: unique(mine.map((e) => e.subject)),
      tables: mine.map((e) => e.table),
      retention: unique(mine.map((e) => e.until)),
    };
  });
}
