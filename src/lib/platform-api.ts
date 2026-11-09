/**
 * Kaizena Flow's own API (C4 step 4 of `docs/platform-parity-plan.md`, D517): the pure parts. The stores' Admin API (D355) for the platform's
 * own tools: a token (`kfp_` and 32 random bytes) made by a platform owner with the scopes chosen, shown once and kept only as its SHA-256,
 * reads the platform's stores, plans, requests and figures at `/api/platform/v1/{resource}`. Read only: nothing it does changes the platform.
 * Nothing here reads the database.
 */

export const PLATFORM_API_SCOPES = ["stores:read", "plans:read", "requests:read", "figures:read"] as const;
export type PlatformApiScope = (typeof PLATFORM_API_SCOPES)[number];
export const isPlatformApiScope = (value: string): value is PlatformApiScope => (PLATFORM_API_SCOPES as readonly string[]).includes(value);

export const PLATFORM_TOKEN_PREFIX = "kfp_";
/** A token as made: `kfp_` and 43 characters of base64url (32 bytes). */
export const PLATFORM_TOKEN_SHAPE = /^kfp_[A-Za-z0-9_-]{43}$/;

/** The platform token in an `Authorization: Bearer …` header, or null. */
export function platformBearer(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match && PLATFORM_TOKEN_SHAPE.test(match[1]) ? match[1] : null;
}

export type PlatformApiRoute =
  | { name: "stores"; scope: "stores:read" }
  | { name: "store"; scope: "stores:read"; id: string }
  | { name: "plans"; scope: "plans:read" }
  | { name: "requests"; scope: "requests:read" }
  | { name: "figures"; scope: "figures:read" };

/** The operations, for the page that lists them: method, path and scope. */
export const PLATFORM_API_OPERATIONS: readonly { path: string; scope: PlatformApiScope }[] = [
  { path: "/stores", scope: "stores:read" },
  { path: "/stores/{id or slug}", scope: "stores:read" },
  { path: "/plans", scope: "plans:read" },
  { path: "/requests", scope: "requests:read" },
  { path: "/figures", scope: "figures:read" },
];

/** The route a GET asks for, from the path after `/api/platform/v1/`; null for none. */
export function platformRouteOf(path: readonly string[]): PlatformApiRoute | null {
  const [resource, id, ...rest] = path;
  if (rest.length > 0) return null;
  if (resource === "stores") return id === undefined ? { name: "stores", scope: "stores:read" } : /^[a-z0-9-]{1,63}$/i.test(id) ? { name: "store", scope: "stores:read", id } : null;
  if (id !== undefined) return null;
  if (resource === "plans") return { name: "plans", scope: "plans:read" };
  if (resource === "requests") return { name: "requests", scope: "requests:read" };
  if (resource === "figures") return { name: "figures", scope: "figures:read" };
  return null;
}

/** A list's page: `limit` (1 to 100, 50 when not given) and `before` (the `created_at` of the last row of the page before), else a problem. */
export function listQuery(params: URLSearchParams): { ok: true; limit: number; before: string | null } | { ok: false; problem: string } {
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { ok: false, problem: "limit is a whole number from 1 to 100." };
  const before = params.get("before");
  if (before !== null && Number.isNaN(Date.parse(before))) return { ok: false, problem: "before is a time, as created_at gives it." };
  return { ok: true, limit, before: before === null ? null : new Date(before).toISOString() };
}

export const REQUEST_STATES = ["pending", "approved", "declined", "all"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export const isRequestState = (value: string): value is RequestState => (REQUEST_STATES as readonly string[]).includes(value);
