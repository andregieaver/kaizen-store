import { createHmac, timingSafeEqual } from "node:crypto";

import { EDIT_MINUTES, ENTER_SECONDS } from "./edit-link";

/**
 * The pass that lets signed-in staff change the words of a page on a store's own domain (D193). There the admin's session cannot be
 * seen (P7: a store's pages, and code its owner adds to them, are another site from the admin), so the admin vouches for the person
 * instead, in two steps that each carry a signed, short-lived token and nothing else:
 *
 *  - `enter`: minted by the admin for a person who may change the store's website, and carried to the store's host in the address of
 *    one redirect. It lives `ENTER_SECONDS` seconds and opens nothing but the exchange for the second.
 *  - `edit`: made by the store's host from an `enter` and kept in an HttpOnly cookie there for `EDIT_MINUTES` minutes. It is
 *    asked by the one route that changes a page's words, which looks the person up again each time (their role, the store being open),
 *    so ending their access ends the pass at once.
 *
 * A token names the store and the account and the kind, is signed with a key made from the server's own secret and cannot be used as
 * the other kind. The key is made apart from every other token's (`derive`).
 */

export type GrantKind = "enter" | "edit";

/** What a token says, once its signature and time are right. */
export type Grant = {
  kind: GrantKind;
  /** The store's id and its slug (the address its pages and admin go by). */
  storeId: string;
  store: string;
  /** The account that was vouched for. */
  account: string;
  /** When it ends, in milliseconds since 1970. */
  expires: number;
};

const LIFETIME_MS: Record<GrantKind, number> = { enter: ENTER_SECONDS * 1000, edit: EDIT_MINUTES * 60_000 };
const VERSION = 1;
const TOKEN_MAX = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:edit-grant").digest();
const signature = (secret: Buffer, body: string) => createHmac("sha256", derive(secret)).update(body).digest("base64url");

/** A token of the kind for a person, which ends after the kind's time. */
export function signGrant(secret: Buffer, grant: Omit<Grant, "expires">, now = Date.now()): string {
  const expires = now + LIFETIME_MS[grant.kind];
  const body = Buffer.from(JSON.stringify([VERSION, grant.kind, grant.storeId, grant.store, grant.account, expires])).toString("base64url");
  return `${body}.${signature(secret, body)}`;
}

/** What a token of this kind says, or null when it is not one: another kind, not signed by this server, altered, or over. */
export function readGrant(secret: Buffer, token: string | null | undefined, kind: GrantKind, now = Date.now()): Grant | null {
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
  const [version, tokenKind, storeId, store, account, expires] = fields as unknown[];
  if (version !== VERSION || tokenKind !== kind) return null;
  if (typeof storeId !== "string" || !UUID.test(storeId) || typeof store !== "string" || !SLUG.test(store) || typeof account !== "string" || !UUID.test(account)) return null;
  // Not over, and not claiming longer than a token of its kind lives.
  if (typeof expires !== "number" || !Number.isFinite(expires) || expires <= now || expires - now > LIFETIME_MS[kind]) return null;
  return { kind, storeId, store, account, expires };
}
