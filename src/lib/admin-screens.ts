/**
 * The admin's screens as heatmaps and recordings of owners' own use name them (D895 phase 3b, `docs/dpia-admin-use.md` section 2): a key
 * made from the address's shape, never a store, an id or a slug, and an allow-list of the screens that may be measured. Default deny: a
 * screen not listed here is never measured, so a new screen is quiet until someone decides it may be. Screens holding shoppers' data or
 * conversations (orders, customers, the inbox and chat, messages and campaigns, documents and invoices, the recordings player, the AI
 * manager) are never on the list (`admin-screens.test.ts`). Pure and browser-safe: the collector computes the key, and the server checks
 * it again.
 */

/** The admin's first-level folders that are not a store (`/admin/{name}`): a store's slug can never be one of them. */
export const OWNER_LEVEL = ["account", "stores", "platform", "legal", "hosting"] as const;

/** A store's screens that may be measured: the section, and which of its second-level screens keep their name (others become `detail`). */
const STORE_SCREENS: Readonly<Record<string, readonly string[]>> = {
  "": [],
  products: ["new", "bulk", "categories", "import", "export"],
  inventory: [],
  discounts: ["new"],
  "price-lists": [],
  pages: ["new", "categories"],
  website: [],
  headers: [],
  footers: [],
  menus: [],
  media: [],
  "product-layouts": [],
  setup: [],
  settings: [
    "accessibility",
    "ai",
    "api",
    "automatic",
    "automation",
    "checkout",
    "close",
    "company",
    "cookies",
    "countries",
    "customs",
    "design",
    "domains",
    "features",
    "invoices",
    "legal",
    "localization",
    "moving",
    "navigation",
    "notifications",
    "orders",
    "payments",
    "prices",
    "producer-responsibility",
    "products",
    "returns",
    "seo",
    "shipping",
    "tax",
    "workflows",
  ],
  analytics: ["heatmaps", "inventory", "marketing", "markets", "products", "reports", "sales", "settings", "speed", "traffic"],
  integrations: [],
  feeds: [],
  redirects: [],
  translate: [],
  staging: [],
  fields: [],
  experiments: [],
  recommendations: [],
  billing: [],
};

/** The owner's own level (`/admin/account/…`, `/admin/stores`, `/admin`) that may be measured. */
const ACCOUNT_SCREENS = ["", "add", "admin-use", "appearance", "billing", "connected", "delete", "developer", "domains", "extensions", "limits", "notices", "themes", "usage"];

/**
 * Sections never measured, whatever the list above says: the screens the assessment names (shoppers' data, conversations, documents and
 * the recordings player). Kept here so a test can hold the list to them.
 */
export const NEVER_MEASURED = [
  "orders",
  "customers",
  "customer-groups",
  "subscribers",
  "support",
  "chat",
  "assistant",
  "broadcasts",
  "campaigns",
  "emails",
  "text-messages",
  "invoices",
  "returns",
  "deliveries",
  "bookings",
  "leads",
  "deals",
  "companies",
  "reviews",
  "analytics/recordings",
  "analytics/customers",
  "analytics/companies",
  "analytics/live",
  "analytics/export",
  "account/support",
  "account/kaizen-support",
  "account/work",
  "account/books",
] as const;

/** A screen's key the server accepts: lower-case words joined by `/`, at most 60 characters. */
export const SCREEN_KEY = /^(?:s|a)(?:\/[a-z0-9-]{1,30}){0,2}$/;

const word = (s: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 30;

/**
 * The key of the admin screen at `pathname`, or null when it is never measured: `s/{section}[/{screen|detail}]` for a store's screens (no
 * store), `a/{screen}` for the owner's own level (`a/account` its first page, `a/stores` the list), `s` and `a` for the two home pages.
 */
export function adminScreenKey(pathname: string): string | null {
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (parts[0] !== "admin") return null;
  const [level, section = "", sub, ...rest] = parts.slice(1);
  if (level === undefined) return "a";
  if (level === "stores") return parts.length === 2 ? "a/stores" : null;
  if (level === "account") {
    if (sub !== undefined || !ACCOUNT_SCREENS.includes(section)) return null;
    return section === "" ? "a/account" : `a/${section}`;
  }
  if ((OWNER_LEVEL as readonly string[]).includes(level)) return null;
  // A store: its slug is dropped.
  const subs = STORE_SCREENS[section];
  if (subs === undefined || !(section === "" || word(section))) return null;
  if (isNever(section, sub)) return null;
  if (section === "") return "s";
  if (sub === undefined) return `s/${section}`;
  if (subs.includes(sub) && rest.length === 0) return `s/${section}/${sub}`;
  // Anything deeper, or an id, a slug or a step: the same `detail` for all, so no name of a store's own leaves the browser.
  if (section === "settings" || section === "analytics") return null;
  return `s/${section}/detail`;
}

function isNever(section: string, sub: string | undefined): boolean {
  const never = NEVER_MEASURED as readonly string[];
  return never.includes(section) || (sub !== undefined && never.includes(`${section}/${sub}`));
}

/** Whether the server keeps anything sent for this key: it is one `adminScreenKey()` can give. */
export function isMeasuredScreen(key: string): boolean {
  if (!SCREEN_KEY.test(key)) return false;
  const [level, section, sub] = key.split("/");
  if (level === "a") return section === undefined || (sub === undefined && (section === "account" || section === "stores" || (section !== "" && ACCOUNT_SCREENS.includes(section))));
  if (section === undefined) return true;
  const subs = STORE_SCREENS[section];
  if (subs === undefined || section === "" || isNever(section, sub)) return false;
  if (sub === undefined) return true;
  return subs.includes(sub) || (sub === "detail" && section !== "settings" && section !== "analytics");
}

/** The lists themselves, for the test that holds them to the admin's folders. */
export const MEASURED = { storeSections: Object.keys(STORE_SCREENS).filter(Boolean), subscreens: STORE_SCREENS, accountScreens: ACCOUNT_SCREENS };
