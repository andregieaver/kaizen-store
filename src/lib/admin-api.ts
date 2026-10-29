/**
 * The Admin API (wave 9 unit B, D355, `docs/wave-9-platform.md` section 3, B): the pure parts. A token (`kf_` and 32 random bytes) belongs to
 * one store and carries scopes; each route names the one scope it needs (`routeOf()`), and a call without it is a 403 that names it. Lists
 * are pages of at most `PAGE_MAX` under an opaque cursor (`?after=`). Money is minor units with the ISO code. Nothing here reads the
 * database.
 */

export const API_SCOPES = [
  "products:read",
  "products:write",
  "inventory:read",
  "inventory:write",
  "orders:read",
  "orders:write",
  "customers:read",
  "customers:write",
  "discounts:read",
  "discounts:write",
  "checkout:read",
  "checkout:write",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const isApiScope = (value: string): value is ApiScope => (API_SCOPES as readonly string[]).includes(value);

/** Scopes a write implies reading too: a token that may change products may read them. */
export function grants(scopes: readonly string[], needed: ApiScope): boolean {
  if (scopes.includes(needed)) return true;
  return needed.endsWith(":read") && scopes.includes(needed.replace(/:read$/, ":write"));
}

export const TOKEN_PREFIX = "kf_";
/** A token as made: `kf_` and 43 characters of base64url (32 bytes). */
export const TOKEN_SHAPE = /^kf_[A-Za-z0-9_-]{43}$/;

/** The token in an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match && TOKEN_SHAPE.test(match[1]) ? match[1] : null;
}

/** Most rows a list answers; the default when none is asked. */
export const PAGE_MAX = 100;
export const PAGE_DEFAULT = 50;

export function pageSize(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, PAGE_MAX) : PAGE_DEFAULT;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string | undefined): value is string => typeof value === "string" && UUID.test(value);

export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiRoute =
  | { name: "products.list" | "products.create"; scope: ApiScope }
  | { name: "products.get" | "products.update"; scope: ApiScope; id: string }
  | { name: "inventory.locations" | "inventory.levels" | "inventory.adjust" | "inventory.set"; scope: ApiScope }
  | { name: "orders.list"; scope: ApiScope }
  | { name: "orders.get" | "orders.fulfil"; scope: ApiScope; id: string }
  | { name: "invoices.ubl" | "credit_notes.ubl"; scope: ApiScope; id: string }
  | { name: "customers.list"; scope: ApiScope }
  | { name: "customers.get" | "customers.tag"; scope: ApiScope; id: string }
  | { name: "customers.untag"; scope: ApiScope; id: string; tag: string }
  | { name: "discounts.list" | "discounts.create"; scope: ApiScope }
  | { name: "checkout.rules" | "checkout.rule_create" | "checkout.fields" | "checkout.field_create"; scope: ApiScope }
  | { name: "checkout.rule_update" | "checkout.rule_delete" | "checkout.field_update" | "checkout.field_delete"; scope: ApiScope; id: string };

/** The route a method and path (after `/api/admin/v1/`) name, or null for none (a 404). */
export function routeOf(method: ApiMethod, path: readonly string[]): ApiRoute | null {
  const [resource, id, sub, extra] = path;
  if (path.length > 4) return null;
  if (resource === "products") {
    if (!id) return method === "GET" ? { name: "products.list", scope: "products:read" } : method === "POST" ? { name: "products.create", scope: "products:write" } : null;
    if (!isUuid(id) || sub) return null;
    return method === "GET" ? { name: "products.get", scope: "products:read", id } : method === "PATCH" ? { name: "products.update", scope: "products:write", id } : null;
  }
  if (resource === "inventory" && !sub) {
    if (id === "locations" && method === "GET") return { name: "inventory.locations", scope: "inventory:read" };
    if (id === "levels" && method === "GET") return { name: "inventory.levels", scope: "inventory:read" };
    if (id === "adjust" && method === "POST") return { name: "inventory.adjust", scope: "inventory:write" };
    if (id === "set" && method === "POST") return { name: "inventory.set", scope: "inventory:write" };
    return null;
  }
  if (resource === "orders") {
    if (!id) return method === "GET" ? { name: "orders.list", scope: "orders:read" } : null;
    if (!isUuid(id)) return null;
    if (!sub) return method === "GET" ? { name: "orders.get", scope: "orders:read", id } : null;
    return sub === "fulfillments" && !extra && method === "POST" ? { name: "orders.fulfil", scope: "orders:write", id } : null;
  }
  // An invoice or a credit note as EN 16931 UBL (D403): `/invoices/{id}/ubl`, `/credit-notes/{id}/ubl`.
  if ((resource === "invoices" || resource === "credit-notes") && id && isUuid(id) && sub === "ubl" && !extra) {
    return method === "GET" ? { name: resource === "invoices" ? "invoices.ubl" : "credit_notes.ubl", scope: "orders:read", id } : null;
  }
  if (resource === "customers") {
    if (!id) return method === "GET" ? { name: "customers.list", scope: "customers:read" } : null;
    if (!isUuid(id)) return null;
    if (!sub) return method === "GET" ? { name: "customers.get", scope: "customers:read", id } : null;
    if (sub !== "tags") return null;
    if (!extra) return method === "POST" ? { name: "customers.tag", scope: "customers:write", id } : null;
    return method === "DELETE" ? { name: "customers.untag", scope: "customers:write", id, tag: decodeURIComponent(extra) } : null;
  }
  // Checkout rules and questions (D399): `/checkout/rules`, `/checkout/rules/{id}`, `/checkout/fields`, `/checkout/fields/{id}`.
  if (resource === "checkout" && (id === "rules" || id === "fields") && !extra) {
    const one = id === "rules" ? "rule" : "field";
    if (!sub) {
      if (method === "GET") return { name: id === "rules" ? "checkout.rules" : "checkout.fields", scope: "checkout:read" };
      return method === "POST" ? { name: `checkout.${one}_create`, scope: "checkout:write" } : null;
    }
    if (!isUuid(sub)) return null;
    if (method === "PATCH") return { name: `checkout.${one}_update`, scope: "checkout:write", id: sub };
    return method === "DELETE" ? { name: `checkout.${one}_delete`, scope: "checkout:write", id: sub } : null;
  }
  if (resource === "discounts" && !id) {
    return method === "GET" ? { name: "discounts.list", scope: "discounts:read" } : method === "POST" ? { name: "discounts.create", scope: "discounts:write" } : null;
  }
  return null;
}

/** An error's code, as the answer's `error.code`, with its HTTP status. */
export const API_ERRORS = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method: 405,
  invalid: 422,
  gated: 403,
  conflict: 409,
  rate_limited: 429,
  failed: 500,
} as const;
export type ApiErrorCode = keyof typeof API_ERRORS;

/** Seconds until the next minute begins: what a 429 asks the caller to wait. */
export const retryAfter = (now: Date = new Date()): number => 60 - now.getUTCSeconds();

/** Every route as the Apps and API page lists it: the method, the path after `/api/admin/v1` and the scope it needs. */
export const API_ROUTES: { method: ApiMethod; path: string; scope: ApiScope }[] = [
  { method: "GET", path: "/products", scope: "products:read" },
  { method: "GET", path: "/products/{id}", scope: "products:read" },
  { method: "POST", path: "/products", scope: "products:write" },
  { method: "PATCH", path: "/products/{id}", scope: "products:write" },
  { method: "GET", path: "/inventory/locations", scope: "inventory:read" },
  { method: "GET", path: "/inventory/levels", scope: "inventory:read" },
  { method: "POST", path: "/inventory/adjust", scope: "inventory:write" },
  { method: "POST", path: "/inventory/set", scope: "inventory:write" },
  { method: "GET", path: "/orders", scope: "orders:read" },
  { method: "GET", path: "/orders/{id}", scope: "orders:read" },
  { method: "GET", path: "/invoices/{id}/ubl", scope: "orders:read" },
  { method: "GET", path: "/credit-notes/{id}/ubl", scope: "orders:read" },
  { method: "POST", path: "/orders/{id}/fulfillments", scope: "orders:write" },
  { method: "GET", path: "/customers", scope: "customers:read" },
  { method: "GET", path: "/customers/{id}", scope: "customers:read" },
  { method: "POST", path: "/customers/{id}/tags", scope: "customers:write" },
  { method: "DELETE", path: "/customers/{id}/tags/{tag}", scope: "customers:write" },
  { method: "GET", path: "/discounts", scope: "discounts:read" },
  { method: "POST", path: "/discounts", scope: "discounts:write" },
  { method: "GET", path: "/checkout/rules", scope: "checkout:read" },
  { method: "POST", path: "/checkout/rules", scope: "checkout:write" },
  { method: "PATCH", path: "/checkout/rules/{id}", scope: "checkout:write" },
  { method: "DELETE", path: "/checkout/rules/{id}", scope: "checkout:write" },
  { method: "GET", path: "/checkout/fields", scope: "checkout:read" },
  { method: "POST", path: "/checkout/fields", scope: "checkout:write" },
  { method: "PATCH", path: "/checkout/fields/{id}", scope: "checkout:write" },
  { method: "DELETE", path: "/checkout/fields/{id}", scope: "checkout:write" },
];
