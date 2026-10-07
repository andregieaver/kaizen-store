import type { RetentionKind } from "./retention";

/**
 * The register of personal data (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 3.5): every table that can hold a person's data names how it
 * links to them, which columns hold the data, which section of the export carries it and what erasure does to it, or says why it holds none.
 * Export, erasure and retention are three readers of this one list, so a table added later cannot be forgotten by all three at once: a test
 * (`src/db/privacy.test.ts`) runs the three detectors below over every table of the `commerce` schema after every migration and fails for a
 * table that matches one and is in neither `PERSONAL_DATA` nor `NOT_PERSONAL`.
 *
 * A new table of shopper data therefore needs: an entry here, an export section (`shapeExport()` / `exportCustomerData()`), an erasure step
 * (`eraseSubject()`), a retention rule if it grows, and a decision in `COPY_RULES`. Nothing here is legal advice; every `reason` that states
 * a legal ground is for review (section 8 of the spec).
 */

/** The sections of the export (`docs/wave-1g-gdpr.md` 2.2). Every key is always present in a file. */
export const EXPORT_SECTIONS = [
  "profile",
  "addresses",
  "orders",
  "invoices",
  "creditNotes",
  "returns",
  "subscriptions",
  "deliveries",
  "wishlists",
  "bonus",
  "referrals",
  "consents",
  "emails",
  "carts",
  "forms",
  "company",
  "customFields",
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export type Subject = "shopper" | "staff" | "host" | "owner" | "business" | "pseudonymous" | "none";
export type LinkVia = "customer" | "email" | "order" | "cart" | "subscription" | "standing_order" | "return" | "withdrawal" | "visitor" | "none";
/** What erasure does: delete the rows, anonymise them (the row stays, the person goes), restrict them (kept for the law until the period ends, then anonymised), keep (not personal or the person's own wish), or nothing (not this unit's subject). */
export type ErasureAction = "delete" | "anonymise" | "restrict" | "keep" | "none";

export type PersonalEntry = {
  /** A `commerce` table, or `storage:{bucket}` for a storage bucket. */
  table: string;
  subject: Subject;
  link: { via: LinkVia; columns: string[] };
  /** The columns (or `col.jsonKey`) that hold the data. Never empty except for `subject: "none"`. */
  personal: string[];
  /** The section of the export that carries it, or null (with the reason in `reason`: a secret, or a pseudonymous log). */
  export: ExportSection | null;
  /** Further sections the table also feeds (a table of orders also feeds `addresses` and `consents`). */
  also?: ExportSection[];
  erasure: ErasureAction;
  /** The retention rule that ends a restrict, a keep or a slow clean-up. */
  until?: RetentionKind;
  /** One sentence: why, for the preview and the shopper's page. */
  reason: string;
};

const via = (v: LinkVia, ...columns: string[]) => ({ via: v, columns });
const none = via("none");

type Extra = { also?: ExportSection[]; until?: RetentionKind };
const entry = (
  table: string,
  subject: Subject,
  link: PersonalEntry["link"],
  personal: string[],
  exportSection: ExportSection | null,
  erasure: ErasureAction,
  reason: string,
  extra: Extra = {},
): PersonalEntry => ({ table, subject, link, personal, export: exportSection, erasure, reason, ...extra });

const LAW = "Kept because bookkeeping law requires it until the retention period ends, then the personal fields are replaced by a marker; used for nothing else.";
const OWN = "Not a shopper's data: this is the store's own, a host's, a staff member's or the platform's, which is a different subject (docs/wave-1g-gdpr.md section 7).";
const PSEUDO = "Kept under a random browser or tab id and cannot be tied to a person; it has its own retention.";
const KEEP_ORDER = "No personal field of its own; it is linked to a person only through the order, and follows the order's restriction and anonymisation.";

export const PERSONAL_DATA: PersonalEntry[] = [
  // The person -----------------------------------------------------------------------------------------------------------------------
  entry("customers", "shopper", via("customer", "id"), ["email", "name", "phone", "address", "company_name", "organisation_number", "locale", "last_sign_in_at", "email_verified_at", "avatar_path", "referred_by_customer_id"], "profile", "delete", "The account is deleted; the password and sign-in records go with it.", { also: ["addresses"] }),
  entry("storage:avatars", "shopper", via("customer", "avatar_path"), ["avatar_path"], "profile", "delete", "The picture is removed from storage after the account is deleted.", {}),

  // Orders and what hangs on them ------------------------------------------------------------------------------------------------------
  entry("orders", "shopper", via("customer", "customer_id", "email"), ["email", "billing_address", "shipping_address", "company_name", "organisation_number", "gift_to", "gift_from", "gift_message", "vat_treatment.buyerVatNumber", "vat_treatment.vies", "delivery.postalCode"], "orders", "restrict", "A sale is kept for the bookkeeping duty (restricted from the person, then anonymised); an unpaid or copied order is anonymised at once.", { also: ["addresses", "consents"], until: "bookkeeping" }),
  entry("order_lines", "shopper", via("order", "order_id"), ["order_id"], "orders", "keep", KEEP_ORDER),
  entry("payments", "shopper", via("order", "order_id"), ["order_id"], "orders", "keep", "A payment's amount and status; no personal field (the card is held by Stripe, not by the store). " + KEEP_ORDER),
  entry("refunds", "shopper", via("order", "payment_id"), ["reason"], "orders", "keep", "Amount and status are kept; the reason is text staff typed (it can hold a name), so it is exported and replaced by a marker when the order is anonymised. " + KEEP_ORDER),
  entry("shipments", "shopper", via("order", "order_id"), ["tracking_number", "tracking_url", "label_url", "undo_reason"], "orders", "keep", "A parcel's carrier and tracking number, linked to a person only through the order. " + "Kept with it. The reason staff gave for undoing a parcel (D174 follow-up) is their own text (it can hold a name): exported with the parcel and replaced by a marker when the order is anonymised."),
  entry("bookings", "shopper", via("order", "order_id"), ["order_id"], "orders", "keep", "A time slot of an appointment, stay or rental; " + KEEP_ORDER),
  entry("shipment_lines", "shopper", via("order", "shipment_id"), ["shipment_id"], "orders", "keep", "Which units of an order went in which parcel (D174); ids and quantities, no personal field. " + KEEP_ORDER),
  entry("order_edits", "shopper", via("order", "order_id"), ["order_id"], "orders", "keep", "A change staff made to an order after purchase (D174): amounts, ids and dates, no personal field (staff's note is only in the history event's data.note, which anonymising removes; the pay link is kept only as a hash). " + KEEP_ORDER),
  entry("order_edit_lines", "shopper", via("order", "order_edit_id"), ["order_edit_id"], "orders", "keep", "The items a change added or took off (D174): titles, SKUs, quantities and amounts, no personal field. " + KEEP_ORDER),
  entry("unsent_closures", "shopper", via("order", "order_id"), ["order_id"], "orders", "keep", "Units of an order line staff took off what was still to send (D174): ids, quantities and the staff account that did it, no personal field of the shopper. " + KEEP_ORDER),
  entry("order_terms", "shopper", via("order", "order_id"), ["order_id"], "orders", "keep", "The record of which terms were accepted and when; no personal field. " + KEEP_ORDER, { also: ["consents"] }),
  entry("legal_snapshots", "none", none, [], null, "none", "The store's own page text as it stood when accepted, never a person's data."),
  entry("order_events", "shopper", via("order", "order_id"), ["data.reason", "data.note"], "orders", "keep", "Events hold types, ids and dates, except the free text staff typed (data.reason of a cancellation or refund, data.note of a note): that is exported and removed when the order is anonymised, which the append-only rule allows for those two keys only.", {}),
  entry("order_downloads", "shopper", via("order", "order_id"), ["token"], "orders", "keep", "No personal field; erasure ends the link (its expiry) because it opens a purchase without a sign-in."),
  entry("order_tags", "shopper", via("order", "order_id"), ["label"], "orders", "keep", "A tag is text staff typed on an order (it can hold a name): exported inside the order's section and kept with the order, then deleted by the daily clean-up once the order is anonymised (the SQL anonymising function deletes nothing). " + KEEP_ORDER),
  entry("draft_orders", "shopper", via("customer", "customer_id"), ["customer_id", "email", "phone", "shipping_address", "billing_address", "company_name", "organisation_number", "note_to_buyer", "internal_note"], "carts", "delete", "A draft is a basket staff made for a buyer, not yet an order: it holds the contact data staff typed. The drafts of a customer account are deleted with it (never matched by an address staff typed, only by the account); any other draft goes 90 days after its last edit (open) or 30 days after it ended, by the daily clean-up. The order a draft made is an order.", { also: ["addresses"] }),
  entry("draft_order_lines", "shopper", via("cart", "draft_id"), ["draft_id"], "carts", "delete", "The lines of a draft order; no personal field of their own, deleted with the draft."),
  entry("inventory_reservations", "shopper", via("cart", "cart_id", "order_id"), ["cart_id", "order_id"], null, "keep", "Stock held for a cart or order; no personal field."),
  entry("host_commissions", "host", via("order", "order_id", "host_id"), ["order_id"], null, "none", OWN),
  entry("document_deliveries", "shopper", via("order", "email_message_id"), ["email_message_id"], null, "keep", "A link between a document and the email that carried it; no personal field."),

  // Documents -------------------------------------------------------------------------------------------------------------------------
  entry("invoices", "shopper", via("order", "order_id"), ["snapshot"], "invoices", "restrict", "An invoice is an accounting document: " + LAW + " Only commerce.anonymise_expired_documents() changes it.", { until: "bookkeeping" }),
  entry("credit_notes", "shopper", via("order", "invoice_id"), ["snapshot"], "creditNotes", "restrict", "A credit note is an accounting document: " + LAW + " Only commerce.anonymise_expired_documents() changes it.", { until: "bookkeeping" }),
  entry("storage:documents", "shopper", via("order", "pdf_path"), ["pdf_path"], null, "restrict", "The PDF of an invoice or credit note holds the same data as the document and is removed when the document is anonymised.", { until: "bookkeeping" }),
  entry("storage:exports", "shopper", none, ["files"], null, "delete", "A store-wide customer or order file an owner made (D165) is not one person's section of the export, so it is not in it: it holds personal data of many people, is deleted after 7 days, and an erasure deletes the store's ready ones; the owner exports again if they need a file without the person.", {}),

  // Withdrawal and returns -----------------------------------------------------------------------------------------------------------
  entry("withdrawal_requests", "shopper", via("withdrawal", "order_id"), ["name", "email"], "returns", "restrict", "A confirmed withdrawal is a legal record of the contract: " + LAW, { also: ["consents"], until: "bookkeeping" }),
  entry("withdrawal_request_lines", "shopper", via("withdrawal", "withdrawal_request_id"), ["withdrawal_request_id"], "returns", "keep", "Quantities of an order's lines; " + KEEP_ORDER),
  entry("returns", "shopper", via("order", "order_id", "withdrawal_request_id"), ["reason_note", "decision_note", "staff_note", "refund_note", "label_url"], "returns", "restrict", "A return is history that is never deleted: " + LAW, { until: "bookkeeping" }),
  entry("return_lines", "shopper", via("return", "return_id"), ["decline_reason", "deduction_note"], "returns", "keep", "Quantities, the condition of the goods and a staff note about the goods, not the person; " + KEEP_ORDER),
  entry("withdrawal_attempts", "pseudonymous", via("none"), ["key_hash"], null, "none", "Hashed keys of guesses at the withdrawal function, kept one day to limit abuse; they cannot be tied to a person."),

  // Subscriptions and standing lists --------------------------------------------------------------------------------------------------
  entry("subscriptions", "shopper", via("customer", "customer_id", "email"), ["email", "shipping_address", "manage_token", "customer_id"], "subscriptions", "anonymise", "The subscription is cancelled at once (no refund) and its email and address are replaced by a marker; its renewal orders are restricted as orders.", { also: ["addresses"] }),
  entry("subscription_lines", "shopper", via("subscription", "subscription_id"), ["subscription_id"], "subscriptions", "keep", "Product lines of a subscription; no personal field."),
  entry("standing_orders", "shopper", via("customer", "customer_id"), ["shipping_address", "card_label", "stripe_customer", "payment_method"], "deliveries", "delete", "The standing list is deleted and the saved card is detached at Stripe.", { also: ["addresses", "consents"] }),
  entry("standing_order_lines", "shopper", via("standing_order", "standing_order_id"), ["standing_order_id"], "deliveries", "delete", "The lines of the standing list go with it."),
  entry("standing_deliveries", "shopper", via("standing_order", "standing_order_id", "order_id"), ["standing_order_id"], "deliveries", "delete", "The record of each delivery goes with the standing list; the order it made is an order."),
  entry("checkout_accounts", "shopper", via("customer", "customer_id", "order_id"), ["customer_id", "password_hash"], null, "delete", "The password chosen at checkout; deleted (never exported: a secret)."),

  // Sign-in ---------------------------------------------------------------------------------------------------------------------------
  entry("customer_sessions", "shopper", via("customer", "customer_id"), ["customer_id", "token_hash"], null, "delete", "Browsers signed in: deleted (never exported: a security record).", { until: "customer_sessions" }),
  entry("customer_codes", "shopper", via("email", "email"), ["email", "code_hash"], null, "delete", "Sign-in codes asked for by this address; deleted.", { until: "customer_codes" }),
  entry("customer_sign_in_links", "shopper", via("customer", "customer_id"), ["customer_id", "token_hash"], null, "delete", "Sign-in links; deleted."),

  // Wishlists and carts ---------------------------------------------------------------------------------------------------------------
  entry("wishlists", "shopper", via("customer", "customer_id"), ["customer_id", "name", "browser_token_hash"], "wishlists", "delete", "The lists are deleted."),
  entry("wishlist_items", "shopper", via("customer", "wishlist_id"), ["wishlist_id"], "wishlists", "delete", "The items go with the list."),
  entry("wishlist_cart_adds", "shopper", via("customer", "customer_id", "wishlist_id"), ["customer_id", "wishlist_name"], "wishlists", "anonymise", "What was added to a cart from a list; the person and the list's name are removed."),
  entry("carts", "shopper", via("customer", "customer_id"), ["customer_id", "company_name", "organisation_number", "vat_number", "vat_check_id", "affiliate_code", "gift_to", "gift_from", "gift_message"], "carts", "anonymise", "The cart row stays (an order may point at it); the person and the company details are cleared.", { until: "carts" }),
  entry("cart_lines", "shopper", via("cart", "cart_id"), ["cart_id"], "carts", "keep", "Product lines of a cart; no personal field."),
  entry("delivery_quotes", "shopper", via("cart", "cart_id"), ["postal_code", "pickup_points"], "carts", "anonymise", "The postal code a delivery was priced for is removed.", { until: "delivery_quotes" }),
  entry("abandoned_checkouts", "shopper", via("cart", "cart_id", "email"), ["email", "lines"], "carts", "anonymise", "The email and the lines are cleared; the opt-out record stays.", { also: ["consents"] }),

  // Loyalty ---------------------------------------------------------------------------------------------------------------------------
  entry("bonus_entries", "shopper", via("customer", "customer_id"), ["customer_id", "note"], "bonus", "delete", "The ledger is deleted with the account: credits are forfeited (said before the person confirms)."),
  entry("bonus_allocations", "shopper", via("customer", "entry_id"), ["entry_id"], "bonus", "delete", "Which credits paid for what; deleted with the ledger."),
  entry("affiliates", "shopper", via("customer", "customer_id"), ["customer_id", "code", "blocked_reason"], "referrals", "delete", "The referral code and its record are deleted with the account."),
  entry("affiliate_attributions", "shopper", via("customer", "affiliate_customer_id", "friend_customer_id"), ["affiliate_customer_id", "friend_customer_id"], "referrals", "anonymise", "The rows stay for the other person's reward; both customer ids are set to null (the foreign keys do it)."),
  entry("referral_visits", "pseudonymous", via("none"), ["code"], null, "none", PSEUDO),

  // Company -------------------------------------------------------------------------------------------------------------------------
  entry("customer_companies", "business", via("customer", "id"), ["name"], "company", "keep", "The company is the business's data and stays with its other members; the preview warns when the person is its main account."),
  entry("company_invites", "shopper", via("email", "email", "customer_id"), ["email", "customer_id", "token_hash"], "company", "delete", "Invitations to the address or account are deleted."),

  // Email and consent -----------------------------------------------------------------------------------------------------------------
  entry("email_messages", "shopper", via("email", "to_address"), ["to_address", "subject", "html", "text"], "emails", "anonymise", "The address, subject and body are blanked and the row kept (its idempotency key stops a replayed webhook from sending again); the withdrawal acknowledgement waits for its order.", { until: "email_bodies" }),
  entry("email_opt_outs", "shopper", via("email", "email"), ["email"], "consents", "keep", "A suppression record: kept so the store does not email the person again (their own wish); erasing it would undo it."),
  entry("form_submissions", "shopper", via("email", "email", "visitor"), ["email", "visitor", "payload"], "forms", "delete", "Sign-ups and messages sent by this address are deleted.", { also: ["consents"], until: "form_submissions" }),
  entry("consents", "pseudonymous", via("visitor", "visitor"), ["visitor", "choices"], null, "none", "Cookie consent is kept under a random browser id and cannot be tied to a person; said in the file's notIncluded.", { until: "consents" }),
  entry("visits", "pseudonymous", via("visitor", "visitor"), ["visitor"], null, "none", PSEUDO, { until: "visits" }),
  entry("product_views", "pseudonymous", via("none"), [], null, "none", "Counts of views per product and day; no person.", { until: "visits" }),
  entry("experiment_exposures", "pseudonymous", via("visitor", "visitor"), ["visitor"], null, "none", PSEUDO),
  entry("experiment_events", "pseudonymous", via("visitor", "visitor"), ["visitor"], null, "none", PSEUDO),
  entry("experiment_carts", "pseudonymous", via("visitor", "visitor"), ["visitor"], null, "none", PSEUDO),
  entry("search_queries", "pseudonymous", via("none"), ["query", "filters"], null, "none", "What was typed in the search box is kept without any identifier; 90 days.", { until: "search_queries" }),
  entry("search_clicks", "pseudonymous", via("none"), [], null, "none", PSEUDO),
  entry("recommendation_events", "pseudonymous", via("visitor", "session"), ["session"], null, "none", PSEUDO, { until: "recommendation_events" }),
  entry("recommendation_adds", "pseudonymous", via("visitor", "session"), ["session"], null, "none", PSEUDO, { until: "recommendation_events" }),
  entry("chat_usage", "pseudonymous", via("none"), [], null, "none", "Counts of turns and checks by a hashed key; no person."),

  // Fields ----------------------------------------------------------------------------------------------------------------------------
  entry("field_values", "shopper", via("customer", "entity_id"), ["values"], "customFields", "delete", "Fields staff filled in about the customer are deleted with the account; an order's are deleted when the order is anonymised."),

  // Tax -------------------------------------------------------------------------------------------------------------------------------
  entry("vat_checks", "shopper", via("order", "id"), ["name", "address", "number"], "orders", "restrict", "The answer of the VAT number check about a buyer's business: " + LAW, { until: "bookkeeping" }),

  // Processors' queues ----------------------------------------------------------------------------------------------------------------
  entry("webhook_events", "shopper", via("none"), ["payload"], null, "keep", "A payment provider's event holds a name, an email and an address; the payload is emptied 90 days after it was processed and the row stays so its id de-duplicates.", { until: "webhook_payloads" }),
  entry("integration_deliveries", "shopper", via("none"), ["payload"], null, "keep", "A queue of events sent to the store's connected services, deleted after 30 days; the services keep their own copies (said in the file's notIncluded).", { until: "integration_deliveries" }),
  entry("privacy_requests", "shopper", via("email", "subject_email", "subject_customer_id"), ["subject_email", "subject_customer_id", "note", "plan_summary"], null, "anonymise", "The record that a request was answered in time: the address is forgotten 30 days after it was answered, the row (counts and dates only) after 24 months.", { until: "privacy_request_contact" }),
  entry("idempotency_keys", "none", none, [], null, "none", "An unused table; it holds a request key and a response, nothing is written to it."),

  // The owner's own bookkeeping -----------------------------------------------------------------------------------------------------
  entry("work_clients", "business", via("none"), ["name", "legal_name", "contact_name", "billing_email", "billing_address", "phone", "notes"], null, "none", "Work is the owner's own accounting (D122), kept under the bookkeeping duty and a separate subject; the preview warns when the person is a Work client."),
  entry("work_assignments", "business", via("none"), ["name"], null, "none", "The owner's own accounting (D122); " + OWN),
  entry("work_credit_notes", "business", via("none"), ["lines"], null, "none", "The owner's own accounting (D122); " + OWN),
  entry("work_events", "business", via("none"), ["data"], null, "none", "The owner's own accounting (D122); " + OWN),
  entry("work_invoices", "business", via("none"), ["notes"], null, "none", "The owner's own accounting (D122); " + OWN),
  entry("work_recurring_invoices", "business", via("none"), ["name"], null, "none", "The owner's own accounting (D122); " + OWN),
  entry("work_time_entries", "business", via("none"), ["note"], null, "none", "The owner's own accounting (D122); " + OWN),

  // Staff, hosts, owners, applicants, the platform ----------------------------------------------------------------------------------
  entry("accounts", "staff", via("none"), ["email", "name"], null, "none", OWN),
  entry("access_requests", "owner", via("none"), ["email", "name", "message"], null, "none", "People who applied to open a store: the platform's applicants. " + OWN),
  entry("abandoned_plan_checkouts", "owner", via("none"), ["email"], null, "none", "A store owner's unfinished plan checkout. " + OWN),
  entry("accessibility_settings", "owner", via("none"), ["contact_email"], null, "none", "The store's own contact for its accessibility statement. " + OWN),
  entry("assistant_memories", "staff", via("none"), ["content"], null, "none", "The AI manager's memory of a staff member; a retention period is the AI manager owner's decision (docs/wave-1g-gdpr.md section 7)."),
  entry("assistant_messages", "staff", via("none"), ["content"], null, "none", "The AI manager's conversations hold what its tools returned; a retention period is the owner's decision (docs/wave-1g-gdpr.md section 7)."),
  entry("audit_log", "none", none, [], null, "keep", "The activity log holds ids, counts and kinds, never an email or a name (a test scans it); kept 24 months as the record of who did what.", { until: "audit_log" }),
  entry("booking_resources", "staff", via("none"), ["name", "email", "property_address"], null, "none", "A member of staff, a room or a host's property. " + OWN),
  entry("economic_operators", "owner", via("none"), ["name", "electronic_address", "postal_address"], null, "none", "The store's own manufacturer or importer details. " + OWN),
  entry("host_stripe_accounts", "host", via("none"), ["host_id"], null, "none", OWN),
  entry("host_tax_details", "host", via("none"), ["legal_name", "address"], null, "none", "A host's tax details (DAC7). " + OWN),
  entry("hosts", "host", via("none"), ["name"], null, "none", OWN),
  entry("kaizen_life_links", "owner", via("none"), ["life_email"], null, "none", "An owner's link to Kaizen Life. " + OWN),
  entry("wordpress_connections", "owner", via("none"), ["site_name"], null, "none", "A WordPress site an owner connected (D169): its address and name, a hash of its token, never the token. " + OWN),
  entry("referral_entries", "owner", via("none"), ["note"], null, "none", "Referral credit between store owners (D131). " + OWN),
  entry("return_settings", "owner", via("none"), ["return_address"], null, "none", "The store's own return address. " + OWN),
  entry("store_locations", "owner", via("none"), ["name", "phone", "notes"], null, "none", "The store's own places. " + OWN),
  entry("store_roles", "staff", via("none"), ["name"], null, "none", OWN),
  entry("stores", "owner", via("none"), ["name", "legal_name", "contact_email", "postal_address"], null, "none", "The store itself. " + OWN),
  entry("products", "host", via("none"), ["host_id"], null, "none", "A product may belong to a host. " + OWN),
];

/** Tables the detectors matched (by a column name such as `name`, `note` or `content`, or a foreign key) that hold no person's data, and why. */
export const NOT_PERSONAL: Record<string, string> = {
  ai_model_prices: "A model's price and the platform admin's note about it.",
  booking_seasons: "A season's name for a booking's price.",
  calendar_feeds: "The name of another site's calendar the store reads.",
  bulk_edit_batches: "A bulk edit's action, its figures and who made it (D165): staff account ids and counts, never a shopper's data.",
  bulk_edit_items: "A changed cell of a bulk edit (D165): a product's status, a price, stock, cost or SKU before and after; figures and codes, never a person.",
  campaigns: "The name and rules of an offer.",
  cart_reminder_steps: "The store's own reminder email text, written for every shopper.",
  chat_agents: "The name and instructions of the store's chat agent.",
  cookie_notes: "A cookie's description.",
  countries: "Reference data.",
  customer_tiers: "A customer group's name and percentage, and the owner's note about the group.",
  redirects: "The store's own addresses (D168): a path on the store that sends to another, and the staff account that made it. A path is the store's page, never a person's; no visitor, IP address or query string is kept.",
  not_found_hits: "Counts of requests for addresses the store did not have (D168), by day; no IP address, user agent, cookie, referrer or query string is kept, and addresses that could hold a person's data (a token, an email, an id) are never recorded.",
  not_found_ignored: "An address staff hid from the 404 report (D168) and the staff account that did it; never a person's data (the address passed the same filter as the report's).",
  data_jobs: "An import or export (D165): its kind, options, counts and the staff account that ran it. The customer and order files it points to are the `storage:exports` entry; the job itself holds no shopper's data.",
  data_job_items: "A product of an import or a finding about the file (D165): a handle, a SKU, row numbers and a plain sentence that never quotes a cell.",
  data_job_assets: "A picture address an import fetched and the library address it became (D165): product pictures only.",
  delivery_schedules: "A delivery day's name.",
  experiment_variants: "The name of a version in an A/B test.",
  experiments: "The name of an A/B test.",
  field_groups: "The name of a group of custom fields.",
  field_search: "A search index over public fields the store wrote itself.",
  font_files: "A font's files.",
  google_places: "A business place's address, the store's own.",
  inventory_locations: "The name of a stock location.",
  inventory_movements: "Stock counts and the staff account that changed them (an id, never a name); the note is staff text about stock, and a movement holds no shopper's data.",
  stock_alerts: "A variant's low-stock state: a state, two times and a stock figure.",
  invoice_settings: "The store's invoice footer and a switch; `email_with_confirmation` is a boolean, not an address.",
  knowledge_chunks: "Pieces of the store's own knowledge documents, written for every shopper.",
  knowledge_documents: "The store's own knowledge documents.",
  marketing_spend: "The owner's note about an advertising cost.",
  menus: "A menu's name.",
  order_views: "A saved view of the order list (D173): a title, the list's filters and its columns, staff configuration. A saved search text sits in `params.q`: the screen says not to save a search for a person's name, and the audit entry never holds it.",
  order_settings: "The store's order settings (D173): switches, a number of days and the draft counter.",
  plan_features: "A plan comparison row.",
  plan_reminder_steps: "Kaizen's own reminder email text.",
  plans: "A plan's name.",
  platform_languages: "A language's name.",
  product_files: "A downloadable file's name.",
  retention_rules: "The platform's retention schedule: periods, sources and dates, never a person.",
  resource_blocks: "A closure of a room or item and the staff's note about it, not about a customer.",
  saved_parts: "A saved page part's name and content.",
  shipping_carriers: "The store's own agreement and details with a carrier.",
  shipping_vat_rules: "A country's shipping VAT rule and a note.",
  store_themes: "A saved design theme's name.",
  terms: "A category or tag's name.",
  ui_translations: "Interface text in a language.",
  vat_rates: "A country's VAT rate and a note about its source.",
};

export type EmailClass = "shopper" | "staff" | "security" | "evidence";

/**
 * Every kind passed to `sendEmail()` (the scan test in `personal-data.test.ts` fails for one that is not here). `shopper`: sent to the person
 * and blanked by erasure; `staff`: sent to the store's people or owners (blanked when linked to the person's orders); `security`: sign-in codes,
 * links, resets and invitations, blanked after 7 days; `evidence`: kept until the order's retention ends (the withdrawal acknowledgement on a
 * durable medium, D153).
 */
export const EMAIL_KINDS: Record<string, EmailClass> = {
  // To the shopper
  "order.confirmation": "shopper",
  "draft.pay_link": "shopper",
  "order.changed": "shopper",
  "subscription.renewed": "shopper",
  "invoice.issued": "shopper",
  "credit_note.issued": "shopper",
  "affiliate.reward": "shopper",
  "bonus.expiry_reminder": "shopper",
  "form.confirm": "shopper",
  "account.welcome": "shopper",
  "company.joined": "shopper",
  "company.ended": "shopper",
  "delivery.started": "shopper",
  "delivery.prepared": "shopper",
  "delivery.card_failed": "shopper",
  "store.message": "shopper",
  "cart_reminder": "shopper",
  "cart_reminder.test": "staff",
  "privacy.erased": "shopper",
  "privacy.extended": "shopper",
  "privacy.refused": "shopper",
  // Security: short-lived
  "account.code": "security",
  "account.reset": "security",
  "company.invite": "security",
  // Evidence (kept with the order)
  "return.acknowledgement": "evidence",
  // To the store's people or the owners
  "booking.staff": "staff",
  "form.message": "staff",
  "form.subscription": "staff",
  "return.overdue": "staff",
  "stock.low": "staff",
  "experiment.guardrail": "staff",
  "store.status": "staff",
  "referral.store_opened": "staff",
  "referral.credit_applied": "staff",
  "plan_reminder": "staff",
  "plan_reminder.test": "staff",
  "privacy.owners_notice": "staff",
  "privacy.due": "staff",
  "privacy.overdue": "staff",
  "data_job.ready": "staff",
  // To a Work client (the owner's own bookkeeping)
  "work.invoice": "staff",
  "work.credit_note": "staff",
  "work.reminder": "staff",
};

/** Kinds built from a prefix and a changing part (`subscription.${change}`, `security.${event}`, `booking.staff_${change}`). */
export const EMAIL_KIND_PREFIXES: Record<string, EmailClass> = {
  "subscription.": "shopper",
  "security.": "staff",
  "booking.staff_": "staff",
};

export function emailClassOf(kind: string): EmailClass | null {
  if (kind in EMAIL_KINDS) return EMAIL_KINDS[kind];
  const prefix = Object.keys(EMAIL_KIND_PREFIXES)
    .filter((p) => kind.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? EMAIL_KIND_PREFIXES[prefix] : null;
}

/** The kinds kept with their order until its retention ends (a test holds this to exactly `return.acknowledgement`). */
export const EVIDENCE_EMAIL_KINDS: readonly string[] = Object.entries(EMAIL_KINDS)
  .filter(([, c]) => c === "evidence")
  .map(([k]) => k);

// ---------------------------------------------------------------------------
// The detectors: what makes a table "look personal" (docs/wave-1g-gdpr.md 3.5).
// ---------------------------------------------------------------------------

/** A, by column name: exactly these, or ending in `_email`, `_phone`, `_address`, or starting with `email_`, `phone_`, `address_`. */
export const DETECTOR_A_COLUMNS: readonly string[] = [
  "customer_id", "email", "phone", "address", "name", "legal_name", "contact_name", "first_name", "last_name", "full_name",
  "ip", "ip_address", "user_agent", "visitor", "to_address", "recipients",
  "postal_code", "postcode", "zip", "zip_code", "birth_date", "date_of_birth", "dob", "birthday",
];
/** `_name` is here because a person's name hides in `author_name`, `reviewer_name`, `recipient_name`, `customer_name`; `NOT_A_PERSON_NAME` lists the columns that end so and are not one. */
export const DETECTOR_A_SUFFIXES: readonly string[] = ["_email", "_phone", "_address", "_name"];
/** Columns ending in `_name` that name a thing (a file, a field, a plan, a carrier), never a person. A new one is added here on purpose, with the table's entry. */
export const NOT_A_PERSON_NAME: readonly string[] = ["file_name"];
export const DETECTOR_A_PREFIXES: readonly string[] = ["email_", "phone_", "address_"];
/** B, by anchor: a foreign key to one of the tables that identify a person (`accounts` is not one: ~80 tables point at it with `created_by`). */
export const DETECTOR_B_ANCHORS: readonly string[] = [
  "customers", "orders", "carts", "subscriptions", "standing_orders", "returns", "withdrawal_requests", "invoices", "credit_notes", "bookings", "wishlists", "hosts",
];
/** C, by free text and payload: where personal data hides in a `jsonb` or a note. */
export const DETECTOR_C_COLUMNS: readonly string[] = [
  "payload", "snapshot", "details", "changes", "query", "filters", "choices", "response", "body", "html", "text", "content", "note", "notes", "reason_note", "message", "data", "lines",
];

export type Detector = "A" | "B" | "C";

export function matchedByColumns(columns: readonly string[]): Detector[] {
  const out: Detector[] = [];
  if (
    columns.some(
      (c) =>
        DETECTOR_A_COLUMNS.includes(c) ||
        DETECTOR_A_SUFFIXES.some((s) => c.endsWith(s) && !NOT_A_PERSON_NAME.includes(c)) ||
        DETECTOR_A_PREFIXES.some((p) => c.startsWith(p)),
    )
  )
    out.push("A");
  if (columns.some((c) => DETECTOR_C_COLUMNS.includes(c))) out.push("C");
  return out;
}

/** All detectors a table matches, given its column names and the tables its foreign keys point at. */
export function detectorsOf(columns: readonly string[], referencedTables: readonly string[]): Detector[] {
  const out = matchedByColumns(columns);
  if (referencedTables.some((t) => DETECTOR_B_ANCHORS.includes(t))) out.push("B");
  return out.sort();
}

export type RegisterProblem = { table: string; problem: string };

/** What is wrong with the register as it stands against a schema (`tables`: name to its columns and the detectors it matched). Empty when complete. */
export function registerProblems(tables: Record<string, { columns: string[]; detectors: Detector[] }>): RegisterProblem[] {
  const out: RegisterProblem[] = [];
  const registered = new Map<string, number>();
  for (const e of PERSONAL_DATA) registered.set(e.table, (registered.get(e.table) ?? 0) + 1);
  for (const [name, info] of Object.entries(tables)) {
    const inRegister = registered.get(name) ?? 0;
    const inNot = name in NOT_PERSONAL;
    if (info.detectors.length > 0 && inRegister === 0 && !inNot) {
      out.push({ table: name, problem: `matched detector ${info.detectors.join("+")} (${info.columns.join(", ")}) and is in neither PERSONAL_DATA nor NOT_PERSONAL` });
    }
    if (inRegister > 0 && inNot) out.push({ table: name, problem: "is in both PERSONAL_DATA and NOT_PERSONAL" });
  }
  for (const [name, count] of registered) {
    if (count > 1) out.push({ table: name, problem: "has more than one entry in PERSONAL_DATA" });
    if (!name.startsWith("storage:") && !(name in tables)) out.push({ table: name, problem: "is in PERSONAL_DATA but is not a table of the commerce schema" });
  }
  for (const name of Object.keys(NOT_PERSONAL)) {
    if (!(name in tables)) out.push({ table: name, problem: "is in NOT_PERSONAL but is not a table of the commerce schema" });
  }
  for (const e of PERSONAL_DATA) {
    const info = tables[e.table];
    if (info) {
      for (const col of e.personal) {
        const base = col.split(".")[0];
        if (!info.columns.includes(base)) out.push({ table: e.table, problem: `lists personal column ${col}, which does not exist` });
      }
    }
  }
  return out;
}
