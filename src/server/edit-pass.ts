import "server-only";

import { cookies } from "next/headers";

import { readGrant, signGrant, type Grant, type GrantKind } from "@/lib/edit-grant";
import { EDIT_MINUTES } from "@/lib/edit-link";
import { parseKey } from "@/lib/secret-box";

import { passMembership, type Membership } from "./auth";

/**
 * The pass for changing a page's words on a store's own domain (D193, `src/lib/edit-grant.ts`): made by the admin for a person who may
 * change the store's website (`/api/platform/editor/grant`), exchanged on the store's host for a cookie there
 * (`/api/platform/editor/enter`), and read by the routes that change words and ask who may (`checkPassPageTypeAccess()`). The cookie is
 * HttpOnly, so a script on a store's page cannot read it, and goes with the requests of the editing routes only.
 */

export const EDIT_COOKIE = "kaizen_edit";
export const EDIT_COOKIE_PATH = "/api/platform/editor";

/** The server's own secret, the one that encrypts what is kept in the database (`encryptionKey()` in `settings.ts`, read here without its imports). */
const signingKey = (): Buffer | null => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);

/** A token for a person of a store, or null when this server has no key to sign with, which leaves the pass off. */
export function mintPass(kind: GrantKind, member: { store: { id: string; slug: string }; account: { id: string } }): string | null {
  const key = signingKey();
  return key ? signGrant(key, { kind, storeId: member.store.id, store: member.store.slug, account: member.account.id }) : null;
}

/** What a token of this kind says, or null. */
export function readPassToken(kind: GrantKind, token: string | null | undefined): Grant | null {
  const key = signingKey();
  return key ? readGrant(key, token, kind) : null;
}

/** The cookie that holds the pass on a store's host. */
export const passCookie = (token: string, secure: boolean) =>
  ({ name: EDIT_COOKIE, value: token, httpOnly: true, secure, sameSite: "lax", path: EDIT_COOKIE_PATH, maxAge: EDIT_MINUTES * 60 }) as const;

/** The same cookie, ended. */
export const endedPassCookie = (secure: boolean) => ({ ...passCookie("", secure), maxAge: 0 }) as const;

/** The pass this request carries, when it is one still good. */
export async function requestPass(): Promise<Grant | null> {
  const token = (await cookies()).get(EDIT_COOKIE)?.value;
  return token ? readPassToken("edit", token) : null;
}

/** The member behind this request's pass in this store: the pass names the store and the account, and the account is looked up again. */
export async function passMember(storeSlug: string): Promise<Membership | null> {
  const pass = await requestPass();
  return pass && pass.store === storeSlug ? passMembership(storeSlug, pass.account) : null;
}
