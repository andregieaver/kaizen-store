import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The pass into a private store (D339, `docs/wave-7-storefront.md` E): a signed token kept in the HttpOnly cookie `kaizen_unlock_{storeId}`
 * on the store's host, read by the proxy without the database. Three kinds:
 *
 *  - `password`: given for the store's password, `PASSWORD_DAYS` days, and only while the store's `private_version` is the one it was given
 *    under (a new password, or *Sign everyone out*, raises it and ends every such pass).
 *  - `staff`: given to a member of the store from the admin (*Preview the store*), `STAFF_HOURS` hours, whatever the version.
 *  - `enter`: the admin's hand-over to the store's own host, `ENTER_SECONDS` seconds, good only for the exchange there (the D193 pattern).
 *
 * A token names the store and its kind and is signed with a key made from the server's own secret for this use alone, apart from every
 * other token's.
 */

export type UnlockKind = "password" | "staff" | "enter";

export type Unlock = {
  kind: UnlockKind;
  storeId: string;
  /** The store's address, for the hand-over to its host. */
  store: string;
  /** The store's `private_version` a password pass was given under; 0 for the others. */
  version: number;
  /** When it ends, in milliseconds since 1970. */
  expires: number;
};

export const PASSWORD_DAYS = 30;
export const STAFF_HOURS = 12;
export const ENTER_SECONDS = 90;

const LIFETIME_MS: Record<UnlockKind, number> = {
  password: PASSWORD_DAYS * 24 * 60 * 60_000,
  staff: STAFF_HOURS * 60 * 60_000,
  enter: ENTER_SECONDS * 1000,
};
const VERSION = 1;
const TOKEN_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const KINDS: readonly UnlockKind[] = ["password", "staff", "enter"];

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:private-unlock").digest();
const signature = (secret: Buffer, body: string) => createHmac("sha256", derive(secret)).update(body).digest("base64url");

/** The cookie that holds a store's pass: one per store, so a visitor let into one store is not let into another. */
export const unlockCookieName = (storeId: string): string => `kaizen_unlock_${storeId}`;

/** How long a pass of the kind lives, in seconds (the cookie's `maxAge`). */
export const unlockSeconds = (kind: UnlockKind): number => Math.floor(LIFETIME_MS[kind] / 1000);

/** A pass of the kind for a store. */
export function signUnlock(secret: Buffer, unlock: Omit<Unlock, "expires">, now = Date.now()): string {
  const expires = now + LIFETIME_MS[unlock.kind];
  const body = Buffer.from(JSON.stringify([VERSION, unlock.kind, unlock.storeId, unlock.store, unlock.version, expires])).toString("base64url");
  return `${body}.${signature(secret, body)}`;
}

/** What a token says, or null when it is not one this server signed, was altered or is over. */
export function readUnlock(secret: Buffer, token: string | null | undefined, now = Date.now()): Unlock | null {
  if (typeof token !== "string" || token.length === 0 || token.length > TOKEN_MAX) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, given] = parts;
  const expected = Buffer.from(signature(secret, body));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let fields: unknown;
  try {
    fields = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(fields) || fields.length !== 6) return null;
  const [version, kind, storeId, store, privateVersion, expires] = fields as unknown[];
  if (version !== VERSION || !KINDS.includes(kind as UnlockKind)) return null;
  if (typeof storeId !== "string" || !UUID.test(storeId) || typeof store !== "string" || !SLUG.test(store)) return null;
  if (typeof privateVersion !== "number" || !Number.isSafeInteger(privateVersion) || privateVersion < 0) return null;
  if (typeof expires !== "number" || !Number.isFinite(expires) || expires <= now) return null;
  return { kind: kind as UnlockKind, storeId, store, version: privateVersion, expires };
}

/**
 * Whether a cookie's token lets its holder into the private store now: a password pass under the store's current version, or a staff
 * pass, for this very store. An `enter` token never does: it is only exchanged.
 */
export function unlocks(secret: Buffer | null, token: string | null | undefined, store: { id: string; version: number }, now = Date.now()): boolean {
  if (!secret) return false;
  const pass = readUnlock(secret, token, now);
  if (!pass || pass.storeId !== store.id) return false;
  return pass.kind === "staff" || (pass.kind === "password" && pass.version === store.version);
}
