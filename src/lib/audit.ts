/**
 * The activity log's rules (wave 1, 1f, `docs/wave-1-trust.md` 2.9, 2.10, 4.7), pure: which area of the admin an
 * action belongs to, which fields of a change may be written down, the sentence an entry reads as, and how long entries
 * are kept.
 *
 * `audit()` (`src/server/auth.ts`) keeps its signature. A new action needs an area here, and a test scans every
 * `audit(` call in `src/` for one (`explicitAreaOf()` is undefined for an action nothing names), so a new action forces
 * a decision. The same table is in the database as `commerce.audit_area_of()`, which fills the old rows; a test holds
 * the two together.
 */

/** The areas of an entry: the store admin's ten, the platform's, and a person's own account. */
export const AUDIT_AREA_KEYS = ["orders", "products", "customers", "marketing", "analytics", "website", "bookings", "settings", "billing", "staff", "platform", "account"] as const;
export type AuditArea = (typeof AUDIT_AREA_KEYS)[number];

export const isAuditArea = (value: unknown): value is AuditArea => (AUDIT_AREA_KEYS as readonly unknown[]).includes(value);

/** How long entries are kept before the daily job prunes them; the database refuses to remove a younger one (`guard_audit_log()`). */
export const AUDIT_RETENTION_MONTHS = 24;

/** Whole actions that belong somewhere other than their prefix's area. These win over every prefix. */
const EXACT: Record<string, AuditArea> = {
  // Orders: booking a shipment is an order's work, the rest of shipping is a setting.
  "shipping.bring_booked": "orders",
  "shipping.helthjem_booked": "orders",
  "shipping.porterbuddy_booked": "orders",
  // The store's own company details (its office and places) are settings; `company.` otherwise is a company account.
  "company.office_saved": "settings",
  // Marketing.
  "store.bonus_settings": "marketing",
  "store.affiliate_settings": "marketing",
  // Website.
  "store.fields_updated": "website",
  "store.ai_translated": "website",
  "store.front_page_changed": "website",
  "store.products_page_changed": "website",
  "store.page_role_changed": "website",
  "store.legal_role_changed": "website",
  "store.navigation_updated": "website",
  "store.part_sharing": "website",
  // Settings: the invoicing switch, note and numbering change legal documents, but they are the owner's settings (D159).
  "invoice.settings_updated": "settings",
  "invoice.series_set": "settings",
  // Staff: the owner's download of the activity log is about the team's doings.
  "activity.exported": "staff",
  // Staff: the store's own two-step switch and its terms.
  "store.two_step_required": "staff",
  "store.two_step_optional": "staff",
  "store.legal_starter_made": "website",
};

/**
 * Prefixes: the longest one an action starts with decides. An action matching none has no explicit area (`areaOfAction()`
 * then answers `settings`, the "everything else" of the activity log, and the scan test fails for a call that relies on it).
 */
const PREFIXES: Record<string, AuditArea> = {
  // Orders
  "order.": "orders",
  "return.": "orders",
  "booking.": "orders",
  "deliveries.": "orders",
  // Invoices and credit notes for orders (D159): exporting, sending again and the documents' own events.
  "invoice.": "orders",
  "credit_note.": "orders",
  "document.": "orders",
  // Products
  "product.": "products",
  "product_layout.": "products",
  "products.": "products",
  "store.product_layout_": "products",
  // Customers
  "customer.": "customers",
  // Privacy requests, exports and erasures (D162); the retention schedule belongs to the platform.
  "privacy.": "customers",
  "tier.": "customers",
  "company.": "customers",
  "company.place_": "settings",
  // Marketing
  "discount.": "marketing",
  "campaign.": "marketing",
  "cart_reminders.": "marketing",
  "recommendations.": "marketing",
  "experiment.": "marketing",
  "search_test.": "marketing",
  // Analytics
  "analytics.": "analytics",
  // Website
  "page.": "website",
  "article.": "website",
  "header.": "website",
  "footer.": "website",
  "site_": "website",
  "field_group.": "website",
  "term.": "website",
  // Redirects and the 404 report (wave 2, D168): a changed address, a redirect by hand or by file, an address hidden from the report.
  "redirect.": "website",
  "redirects.": "website",
  "not_found.": "website",
  "store.page_": "website",
  "store.article_": "website",
  "store.header_": "website",
  "store.footer_": "website",
  "store.theme_": "website",
  "store.saved_theme_": "website",
  "store.menu_": "website",
  "store.media_": "website",
  "store.css_": "website",
  "store.template_": "website",
  "store.fonts_": "website",
  "store.part_": "website",
  "store.products_page_": "website",
  "store.front_page_": "website",
  // Bookings
  "booking_resource.": "bookings",
  "resource_block.": "bookings",
  "calendar_feed.": "bookings",
  "host.": "bookings",
  "hosts.": "bookings",
  "bookings.": "bookings",
  // Billing
  "billing.": "billing",
  // Staff
  "staff.": "staff",
  "role.": "staff",
  "store.two_step_": "staff",
  // Platform
  "platform.": "platform",
  "language.": "platform",
  "ai.platform_": "platform",
  "google.platform_": "platform",
  "plan_reminders.": "platform",
  "vat.": "platform",
  "retention.": "platform",
  // A person's own account
  "account.": "account",
  // Settings: what is left, named so that a new action under one of them needs no decision but a new prefix does.
  "payments.": "settings",
  "shipping.": "settings",
  "returns.": "settings",
  "store.": "settings",
  "ai.": "settings",
  "integration.": "settings",
  "localization.": "settings",
  "cookies.": "settings",
  "chat.": "settings",
  "knowledge.": "settings",
  "google.": "settings",
  "work.": "settings",
};

/** The two tables as the database's `audit_area_of()` is made from them. */
export const AUDIT_AREAS = { exact: EXACT, prefixes: PREFIXES } as const;

/** Prefixes longest first, so the first match is the longest. */
const ORDERED_PREFIXES = Object.entries(PREFIXES).sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));

/** The area an action is named in, or undefined when nothing names it. */
export function explicitAreaOf(action: string): AuditArea | undefined {
  const exact = EXACT[action];
  if (exact) return exact;
  return ORDERED_PREFIXES.find(([prefix]) => action.startsWith(prefix))?.[1];
}

/** The area an action belongs to; `settings` for an action nothing names. */
export const areaOfAction = (action: string): AuditArea => explicitAreaOf(action) ?? "settings";

/** The area to show for a stored entry: its own, else the one its action's prefix gives (rows from before the column). */
export const areaOfEntry = (entry: { area?: string | null; action: string }): AuditArea => (isAuditArea(entry.area) ? entry.area : areaOfAction(entry.action));

/** Every explicit rule as SQL for `commerce.audit_area_of()`: `[condition, area]` pairs in the order they must be tried. */
export function areaRulesAsSql(): { when: string; area: AuditArea }[] {
  const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
  return [
    ...Object.entries(EXACT).map(([action, area]) => ({ when: `p_action = ${quote(action)}`, area })),
    ...ORDERED_PREFIXES.map(([prefix, area]) => ({ when: `starts_with(p_action, ${quote(prefix)})`, area })),
  ];
}

// ---------------------------------------------------------------------------
// What may be written down about a change
// ---------------------------------------------------------------------------

/** The kinds of thing whose changes are written as before and after. */
export const AUDIT_KINDS = ["product", "price", "page", "discount", "shipping", "staff", "role", "payments", "store"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

/**
 * The fields of each kind that may carry a value in `changes`. A field that changed but is not here is written as
 * `{ changed: true }` with no value; a field whose name looks like a secret never is written at all.
 */
export const ALLOWED_FIELDS: Record<AuditKind, readonly string[]> = {
  product: ["title", "status", "handle", "kind", "vatCategory", "categoryIds", "tagIds", "variantCount", "soldByMeasure", "measures"],
  price: ["sku", "market", "currency", "priceMinor"],
  page: ["title", "address", "state", "rowCount", "blockCount"],
  discount: ["code", "kind", "value", "minimumMinor", "usageLimit", "perCustomerLimit", "startsAt", "endsAt", "active"],
  shipping: ["rates", "freeAboveMinor", "currency"],
  staff: ["email", "role", "roleName", "kind", "expiresAt", "disabled"],
  role: ["name", "permissions"],
  payments: ["enabled", "mode", "orderInvoices"],
  store: ["termsAtCheckout", "requireTwoStep", "legalRole", "pageId"],
};

/** A key that may hold a secret, a token, a credential or a bank number: never written, whatever the allowlist says. */
export const SECRET_KEY = /secret|token|password|key|iban|authorization|cookie/i;
/** The longest value written; a longer one is cut and ends with an ellipsis. */
export const MAX_VALUE_LENGTH = 300;

export type FieldChange = { from: unknown; to: unknown } | { changed: true };
export type AuditChanges = Record<string, FieldChange>;

const clip = (value: unknown): unknown => {
  if (typeof value === "string") return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;
  if (value !== null && typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;
  }
  return value;
};

/** Structural equality of plain data (what JSON would show): key order does not matter for objects. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => sameValue(x[k], y[k]));
}

/**
 * The changes between two states of a thing: each field that differs, with its values when the kind's allowlist has it
 * and its name is not a secret's, `{ changed: true }` when it is not on the list. Fields that are the same are left out.
 * `refused` names the secret-like fields that changed and were left out altogether, for the caller to log.
 */
export function diffOf(kind: AuditKind, before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined): { changes: AuditChanges; refused: string[] } {
  const allowed = new Set(ALLOWED_FIELDS[kind]);
  const b = before ?? {};
  const a = after ?? {};
  const changes: AuditChanges = {};
  const refused: string[] = [];
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  for (const field of fields) {
    if (sameValue(b[field], a[field])) continue;
    if (SECRET_KEY.test(field)) {
      refused.push(field);
      continue;
    }
    changes[field] = allowed.has(field) ? { from: clip(b[field] ?? null), to: clip(a[field] ?? null) } : { changed: true };
  }
  return { changes, refused };
}

/** Whether `changes` holds a value for a secret-like key or one too long: a last check before a row is written. */
export function changesProblem(changes: unknown): string | null {
  if (changes == null) return null;
  if (typeof changes !== "object" || Array.isArray(changes)) return "changes must be an object";
  for (const [field, change] of Object.entries(changes as Record<string, unknown>)) {
    if (SECRET_KEY.test(field)) return `a secret-like field (${field}) is never written`;
    if (change == null || typeof change !== "object") return `${field}: not a change`;
    const c = change as Record<string, unknown>;
    if (c.changed === true) continue;
    for (const side of ["from", "to"]) {
      const text = typeof c[side] === "string" ? (c[side] as string) : JSON.stringify(c[side] ?? null);
      if (text.length > MAX_VALUE_LENGTH) return `${field}.${side} is longer than ${MAX_VALUE_LENGTH} characters`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The sentence
// ---------------------------------------------------------------------------

export type AuditTarget = { type: string; id: string; label?: string };

const WORDS: Record<string, (label: string) => string> = {
  "product.created": (l) => `Created the product ${l}`,
  "product.updated": (l) => `Changed the product ${l}`,
  "product.archived": (l) => `Archived the product ${l}`,
  "product.price_changed": (l) => `Changed the price of ${l}`,
  "store.page_saved": (l) => `Saved the page ${l}`,
  "store.page_published": (l) => `Published the page ${l}`,
  "store.page_unpublished": (l) => `Unpublished the page ${l}`,
  "store.page_deleted": (l) => `Deleted the page ${l}`,
  "page.published_with_issues": (l) => `Published the page ${l} with checks unresolved`,
  "store.page_published_with_issues": (l) => `Published the page ${l} with checks unresolved`,
  "store.article_saved": (l) => `Saved the article ${l}`,
  "store.article_published": (l) => `Published the article ${l}`,
  "store.article_unpublished": (l) => `Unpublished the article ${l}`,
  "store.article_deleted": (l) => `Deleted the article ${l}`,
  "discount.created": (l) => `Created the coupon ${l}`,
  "discount.updated": (l) => `Changed the coupon ${l}`,
  "discount.deleted": (l) => `Deleted the coupon ${l}`,
  "shipping.updated": () => "Changed the shipping settings",
  "payments.provider_updated": () => "Changed the payment settings",
  "staff.invited": (l) => `Invited ${l}`,
  "staff.disabled": (l) => `Removed ${l}`,
  "staff.role_assigned": (l) => `Changed the role of ${l}`,
  "staff.collaborator_invited": (l) => `Invited ${l} as a collaborator`,
  "staff.collaborator_expired": (l) => `The collaborator access of ${l} ended`,
  "staff.collaborator_extended": (l) => `Extended the collaborator access of ${l}`,
  "role.created": (l) => `Created the role ${l}`,
  "role.updated": (l) => `Changed the role ${l}`,
  "role.deleted": (l) => `Deleted the role ${l}`,
  "store.two_step_required": () => "Required two-step sign-in for the store",
  "store.two_step_optional": () => "Stopped requiring two-step sign-in for the store",
  "store.terms_mode_changed": () => "Changed what checkout says about the terms",
  "store.legal_starter_made": (l) => `Made a draft of ${l}`,
  "store.legal_role_changed": (l) => `Chose the page for ${l}`,
  "account.wordpress_approved": (l) => `${l} connected a WordPress site to their stores`,
  "account.wordpress_revoked": (l) => `${l} disconnected a WordPress site`,
  "account.two_step_enrolled": (l) => `${l} switched on two-step sign-in`,
  "account.two_step_removed": (l) => `${l} switched off two-step sign-in`,
  "account.two_step_passed": (l) => `${l} passed the second step`,
  "account.two_step_failed": (l) => `A wrong second-step code was entered for ${l}`,
  "account.two_step_attempt": (l) => `A second-step attempt was started for ${l}`,
  "account.two_step_attempt_cleared": (l) => `A second-step attempt for ${l} could not be checked and was not counted`,
  "account.two_step_reset": (l) => `A platform admin reset two-step sign-in for ${l}`,
  "account.recovery_codes_generated": (l) => `${l} made new recovery codes`,
  "account.recovery_code_used": (l) => `${l} used a recovery code`,
  "activity.exported": () => "Downloaded the activity log",
};

const humanise = (action: string): string => {
  const text = action.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The sentence an entry reads as, made by code from the action and its target: "Changed the price of Demo: Lampe". */
export function summaryOf(action: string, target?: AuditTarget | null, changes?: AuditChanges | null): string {
  const label = target?.label?.trim() || (target ? `${target.type} ${target.id}` : "");
  const words = WORDS[action];
  let text = words ? words(label || "it") : label ? `${humanise(action)}: ${label}` : humanise(action);
  const names = changes ? Object.keys(changes) : [];
  if (names.length > 0 && !words) text += ` (${names.join(", ")})`;
  return text;
}
