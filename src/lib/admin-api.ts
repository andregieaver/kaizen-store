/**
 * The Admin API (wave 9 unit B, D355, `docs/wave-9-platform.md` section 3, B): the pure parts. A token (`kf_` and 32 random bytes) belongs to
 * one store and carries scopes; each operation names the one scope it needs (`ADMIN_API` in `admin-api-routes.ts`, D438, which `routeOf()`
 * routes by), and a call without it is a 403 that names it. Lists are pages of at most `PAGE_MAX` under an opaque cursor (`?after=`). Money
 * is minor units with the ISO code. Nothing here reads the database.
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
