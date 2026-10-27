import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import { privatePasswordProblem } from "@/lib/private-mode";
import { signUnlock, unlockCookieName, unlockSeconds, unlocks, type UnlockKind } from "@/lib/unlock-pass";

import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";
import { unlockSecret } from "./private-secret";
import { forgetStoreFacts } from "./redirect-resolve";
import { refreshTag } from "./refresh";
import { STORES_TAG } from "./seo";
import { storeTag } from "./stores";

/**
 * Private mode (D339, `docs/wave-7-storefront.md` E): the only writer of `stores.private_mode`, `private_password` and `private_version`, and
 * the passes that let visitors and staff in. The proxy reads the state from the store's facts and the pass from the cookie (`unlocks()`);
 * routes that answer a visitor outside the pages (the chat, recommendations, feeds) ask `lockedOut()`.
 */

type Row = Record<string, unknown>;

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;
const COST = { N: 16_384, r: 8, p: 1 };
const KEY_LENGTH = 32;


/** A password as kept: `scrypt$N$r$p$salt$hash`, the salt random for each. */
export async function hashPrivatePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

/** Whether a password is the one kept, in constant time; false for anything kept in another shape. */
export async function privatePasswordMatches(stored: string | null, password: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0) || N > 1 << 20) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, KEY_LENGTH, { N, r, p });
  return timingSafeEqual(actual, expected);
}

export type PrivateResult = { ok: true } | { ok: false; problem: "not_allowed" | "short" | "long" | "never_private" };

/** The caches a change reaches: the store as read, the lists search engines read, and this instance's facts the proxy reads. */
function refreshAfter(slug: string): void {
  refreshTag(storeTag(slug));
  refreshTag(STORES_TAG);
  forgetStoreFacts(slug);
}

/** Switches private mode on or off (`settings:write`), audited as `store.private_mode`. A store template or demo store is never private. */
export async function setPrivateMode(member: Membership, on: boolean): Promise<PrivateResult> {
  if (!memberCan(member, "settings:write")) return { ok: false, problem: "not_allowed" };
  const { store } = member;
  if (store.isTemplate || store.starter) return { ok: false, problem: "never_private" };
  const [row] = await db().execute<Row>(sql`
    update commerce.stores set private_mode = ${on}
     where id = ${store.id}::uuid and private_mode is distinct from ${on}
    returning id`);
  if (row) await audit(member.account.id, store.id, "store.private_mode", { on }, { changes: { privateMode: { from: !on, to: on } } });
  refreshAfter(store.slug);
  return { ok: true };
}

/**
 * Sets the password visitors are let in with, or takes it away (null: only staff get in), audited as `store.private_password` (never the
 * password). Either raises the version, so a visitor let in with the password before is asked again.
 */
export async function setPrivatePassword(member: Membership, password: string | null): Promise<PrivateResult> {
  if (!memberCan(member, "settings:write")) return { ok: false, problem: "not_allowed" };
  if (password !== null) {
    const problem = privatePasswordProblem(password);
    if (problem) return { ok: false, problem };
  }
  const hash = password === null ? null : await hashPrivatePassword(password);
  await db().execute(sql`
    update commerce.stores set private_password = ${hash}, private_version = private_version + 1
     where id = ${member.store.id}::uuid`);
  await audit(member.account.id, member.store.id, "store.private_password", { set: password !== null });
  refreshAfter(member.store.slug);
  return { ok: true };
}

/** Ends every visitor's pass given for the password (staff's previews stay), audited as `store.private_signed_out`. */
export async function signEveryoneOut(member: Membership): Promise<PrivateResult> {
  if (!memberCan(member, "settings:write")) return { ok: false, problem: "not_allowed" };
  await db().execute(sql`update commerce.stores set private_version = private_version + 1 where id = ${member.store.id}::uuid`);
  await audit(member.account.id, member.store.id, "store.private_signed_out");
  refreshAfter(member.store.slug);
  return { ok: true };
}

/**
 * Opening a store makes it public (decision 5): called by `completeSetup()` in its own statement's wake, audited only when it was private.
 * The owner can make it private again from Settings.
 */
export async function openToEveryone(accountId: string, store: { id: string; slug: string }): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    update commerce.stores set private_mode = false where id = ${store.id}::uuid and private_mode returning id`);
  if (row) await audit(accountId, store.id, "store.private_mode", { on: false, via: "opened" }, { changes: { privateMode: { from: true, to: false } } });
  refreshAfter(store.slug);
}

/** What the gate needs of a store: whether it is private now and its version. */
export async function privateState(storeId: string): Promise<{ private: boolean; version: number; password: string | null } | null> {
  const [row] = await db().execute<Row>(sql`
    select private_mode and not (is_template or starter) as private, private_version, private_password
      from commerce.stores where id = ${storeId}::uuid and status = 'active'`);
  return row ? { private: Boolean(row.private), version: Number(row.private_version), password: row.private_password ? String(row.private_password) : null } : null;
}

/**
 * Whether the request in hand is kept out of a store: it is private and the request carries no good pass for it. For the routes a visitor
 * reaches outside the store's pages (the chat, recommendations, feeds), which the proxy never sees.
 */
export async function lockedOut(store: { id: string; privateMode: boolean }): Promise<boolean> {
  if (!store.privateMode) return false;
  const state = await privateState(store.id);
  if (!state?.private) return false;
  const token = (await cookies()).get(unlockCookieName(store.id))?.value;
  return !unlocks(unlockSecret(), token, { id: store.id, version: state.version });
}

/** A pass of the kind for a store, or null when this server has no key to sign with. */
export function mintUnlock(kind: UnlockKind, store: { id: string; slug: string }, version: number): string | null {
  const secret = unlockSecret();
  return secret ? signUnlock(secret, { kind, storeId: store.id, store: store.slug, version }) : null;
}

/** The cookie that holds a pass on the store's host: HttpOnly, for every path of the host, as long as the pass lives. */
export const unlockCookie = (storeId: string, token: string, kind: UnlockKind, secure: boolean) =>
  ({ name: unlockCookieName(storeId), value: token, httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: unlockSeconds(kind) }) as const;
