/**
 * The Admin API (wave 9 unit B, D355, `docs/wave-9-platform.md` section 3, B): the pure parts. A token (`kf_` and 32 random bytes) belongs to
 * one store and carries scopes; each operation names the one scope it needs (`ADMIN_API` in `admin-api-routes.ts`, D438, which `routeOf()`
 * routes by), and a call without it is a 403 that names it. Lists are pages of at most `PAGE_MAX` under an opaque cursor (`?after=`). Money
 * is minor units with the ISO code. Nothing here reads the database.
 */

/**
 * The scopes (D355, D440). The twelve a token could hold before D440 keep exactly what they allowed then; every write D440 added has a
 * scope of its own, which no older token holds. The powers are what the AI manager asks the owner's yes for (publishing and what shoppers
 * see, refunds and cancelling, emails to customers, a customer's sign-in email, discount codes in use, gift cards, the owner's webhooks):
 * the token screen keeps them one step away (`API_POWERS`).
 */
export const API_SCOPES = [
  "products:read",
  "products:write",
  // D440: categories and tags made, pictures uploaded, product files imported; drafts put in categories and given pictures.
  "products:manage",
  "inventory:read",
  "inventory:write",
  "orders:read",
  "orders:write",
  // D440: draft orders made and changed; orders' notes and tags.
  "orders:manage",
  "customers:read",
  "customers:write",
  // D440: customers added, and their name, phone and addresses changed (never their email).
  "customers:manage",
  "discounts:read",
  "discounts:write",
  "checkout:read",
  "checkout:write",
  // D440: pages, articles, content entries and menus read; their drafts written.
  "content:read",
  "content:write",
  // D440: the store's settings and its saved reports, read.
  "settings:read",
  "reports:read",
  // The powers (D440).
  "products:publish",
  "orders:send",
  "orders:refund",
  "customers:email",
  "discounts:publish",
  "gift_cards:write",
  "content:publish",
  "webhooks:write",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/**
 * What the AI manager asks the owner's yes for (D440, its tools' `public`, `send` and `spend` gates): a token does it only with the scope for
 * it, which the token screen offers under *Customise*.
 */
export const API_POWERS = [
  "products:publish",
  "orders:send",
  "orders:refund",
  "customers:email",
  "discounts:publish",
  "gift_cards:write",
  "content:publish",
  "webhooks:write",
] as const satisfies readonly ApiScope[];
export const isApiPower = (scope: string): boolean => (API_POWERS as readonly string[]).includes(scope);

/** The scopes a token could hold before D440 (D355): what each allowed then, it still allows, and no more. */
export const SCOPES_BEFORE_D440: readonly ApiScope[] = [
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
];

export const isApiScope = (value: string): value is ApiScope => (API_SCOPES as readonly string[]).includes(value);

/**
 * Whether scopes allow what `needed` names: the scope itself, or, for a read, any scope of the same area (a token that may change products,
 * manage them or publish them may read them, as one that may change them always could).
 */
export function grants(scopes: readonly string[], needed: ApiScope): boolean {
  if (scopes.includes(needed)) return true;
  if (!needed.endsWith(":read")) return false;
  const area = needed.slice(0, -":read".length);
  return scopes.some((scope) => scope.startsWith(`${area}:`));
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

/** An error's code, as the answer's `error.code`, with its HTTP status. */
export const API_ERRORS = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method: 405,
  invalid: 422,
  gated: 403,
  /** The store has switched off the feature the operation stands behind (D178, D440). */
  feature_off: 403,
  conflict: 409,
  rate_limited: 429,
  failed: 500,
} as const;
export type ApiErrorCode = keyof typeof API_ERRORS;

/** Seconds until the next minute begins: what a 429 asks the caller to wait. */
export const retryAfter = (now: Date = new Date()): number => 60 - now.getUTCSeconds();
