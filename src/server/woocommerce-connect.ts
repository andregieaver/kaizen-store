import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  MOVER_NAMESPACE,
  isMoverSecret,
  moverHeaders,
  openMoverState,
  pluginsOf,
  sealMoverState,
  type MoverRoute,
  type ShopPlugin,
} from "@/lib/woocommerce-mover";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";
import {
  openWooState,
  readIndex,
  readSiteInput,
  readWooKey,
  restUrl,
  sealWooState,
  siteFromIndex,
  siteKey,
  siteOfKey,
  wooAuthorizeUrl,
  type RestRoot,
  type WooSite,
} from "@/lib/woocommerce";

import { audit, passMembership, type Membership } from "./auth";
import { log } from "./log";
import { memberCan } from "./permissions";
import { safeFetch, type Fetched } from "./replicate-fetch";
import { col, typedRow } from "./typed-rows";

/**
 * Connecting a store to the WooCommerce shop it moves from (D446 step 1, `docs/moving-from-woocommerce.md` 4.2, 10), the plain path: the
 * owner types his site's address and presses *Connect WooCommerce*; WordPress's REST root says it has WooCommerce; he approves a read-only
 * key on WooCommerce's own *authorize* page on his site; WooCommerce posts the key to `/api/woocommerce/callback` with the sealed note it
 * carried (`user_id`), which names the store, the owner and the site; the key is tried once against the shop and kept encrypted in
 * `commerce.shop_moves` (`source` `woocommerce`). Every call to the site goes through `safeFetch()` (the owner's address may name any host:
 * never a private network), over HTTPS only, the key only to the site's own origin. The owner's alone. Off until the server can encrypt
 * (`SETTINGS_ENCRYPTION_KEY`). The tests give `open` (`WooDeps`).
 */

export type WooDeps = {
  /** A GET to the site (`safeFetch()` by default), with the key's header when it carries one. */
  open?: (url: string, headers?: Record<string, string>) => Promise<Fetched>;
  now?: number;
};

const OWNER = "owner" as const;
const SOURCE = "woocommerce";
/** The most one REST page may weigh (50 orders with their lines, or 50 products with their texts). */
const PAGE_MAX_BYTES = 12 * 1024 * 1024;

const key = (): Buffer | null => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);

/** Whether *Connect WooCommerce* can work on this server. */
export const wooOffered = (): boolean => key() !== null;

export const wooCallbackUrl = (): string => `${siteUrl()}/api/woocommerce/callback`;

const openUrl = (deps: WooDeps) => deps.open ?? ((url: string, headers?: Record<string, string>) => safeFetch(url, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 45_000, maxRedirects: 3, accept: "application/json", headers }));

const text = (got: Fetched): string => (got.ok ? Buffer.from(got.bytes).toString("utf8") : "");

// ---------------------------------------------------------------------------
// Finding the shop
// ---------------------------------------------------------------------------

export type WooFindProblem = "address" | "not_wordpress" | "not_woocommerce" | "unreachable";
export type WooFound = { ok: true; site: WooSite; root: RestRoot; name: string } | { ok: false; problem: WooFindProblem };

/**
 * The WordPress site behind whatever the owner typed, and where its REST routes are: its REST root asked at `/wp-json/`, then at
 * `/?rest_route=/` (a site without pretty addresses). WooCommerce is there when the root names `wc/v3`.
 */
export async function findWooShop(raw: string, deps: WooDeps = {}): Promise<WooFound> {
  const asked = readSiteInput(raw);
  if (!asked) return { ok: false, problem: "address" };
  const open = openUrl(deps);
  let reached = false;
  for (const root of ["wp-json", "rest_route"] as const) {
    const got = await open(root === "wp-json" ? `https://${siteKey(asked)}/wp-json/` : `https://${siteKey(asked)}/?rest_route=/`);
    if (got.ok || got.status !== undefined) reached = true;
    const index = got.ok ? readIndex(text(got)) : null;
    if (!index) continue;
    if (!index.woo) return { ok: false, problem: "not_woocommerce" };
    return { ok: true, site: siteFromIndex(asked, index), root, name: index.name };
  }
  return { ok: false, problem: reached ? "not_wordpress" : "unreachable" };
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

export type WooStartProblem = WooFindProblem | "off" | "forbidden" | "other_shop";
export type WooStart = { ok: true; url: string } | { ok: false; problem: WooStartProblem };

const random = () => randomBytes(24).toString("base64url");

/** The store's other connected move (Shopify), if any: a store moves from one shop at a time. */
async function otherConnected(storeId: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.shop_moves where store_id = ${storeId}::uuid and source <> ${SOURCE} and status = 'connected'`,
  );
  return (row?.n ?? 0) > 0;
}

/** The press (owner only): the site found, and WooCommerce's *authorize* page on it with the sealed note. */
export async function startWooConnect(member: Membership, raw: string, deps: WooDeps = {}): Promise<WooStart> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "forbidden" };
  const secret = key();
  if (!secret) return { ok: false, problem: "off" };
  if (await otherConnected(member.store.id)) return { ok: false, problem: "other_shop" };
  const found = await findWooShop(raw, deps);
  if (!found.ok) return found;
  const userId = sealWooState(secret, { nonce: random(), store: member.store.slug, account: member.account.id, site: siteKey(found.site), root: found.root }, deps.now);
  return {
    ok: true,
    url: wooAuthorizeUrl(found.site, found.root, {
      appName: "Kaizena Flow",
      userId,
      returnUrl: `${siteUrl()}/admin/${member.store.slug}/settings/moving?woocommerce=back`,
      callbackUrl: wooCallbackUrl(),
    }),
  };
}

type Credentials = { key: string; secret: string; root: RestRoot };

/** A REST call with the key: HTTP Basic over HTTPS, and the key in the query when the host drops the `Authorization` header (some do). */
async function getWith(site: WooSite, creds: Credentials, route: string, query: Record<string, string | number>, deps: WooDeps): Promise<Fetched> {
  const open = openUrl(deps);
  const basic = `Basic ${Buffer.from(`${creds.key}:${creds.secret}`).toString("base64")}`;
  const first = await open(restUrl(site, creds.root, route, query), { Authorization: basic });
  if (first.ok || first.status !== 401) return first;
  return open(restUrl(site, creds.root, route, { ...query, consumer_key: creds.key, consumer_secret: creds.secret }));
}

/**
 * WooCommerce's post to `/api/woocommerce/callback` (answers the HTTP status): the note checked (signed here, not over), the account still
 * the store's owner, the key read-only, and then tried once against the shop. Kept encrypted; the copy and move start afresh.
 */
export async function finishWooConnect(body: unknown, deps: WooDeps = {}): Promise<number> {
  const secret = key();
  const posted = readWooKey(body);
  const state = secret && posted ? openWooState(secret, posted.userId, deps.now) : null;
  if (!secret || !posted || !state) return 400;
  const site = siteOfKey(state.site);
  const member = site ? await passMembership(state.store, state.account) : null;
  if (!site || !member || !memberCan(member, OWNER)) return 403;
  if (await otherConnected(member.store.id)) return 409;
  const creds: Credentials = { key: posted.key, secret: posted.secret, root: state.root };
  const tried = await getWith(site, creds, "wc/v3/settings/general/woocommerce_currency", {}, deps);
  if (!tried.ok) {
    log("warn", "woocommerce.key_refused", { storeId: member.store.id, status: tried.status ?? null });
    return 400;
  }
  const index = await openUrl(deps)(restUrl(site, state.root, ""));
  const name = (index.ok ? readIndex(text(index))?.name : "") ?? "";
  const sealed = encryptSecret(JSON.stringify(creds), secret);
  await db().execute(sql`
    insert into commerce.shop_moves (store_id, source, shop_domain, shop_name, primary_domain, status, scopes, access_token, connected_by, connected_at, copy, move, updated_at)
    values (${member.store.id}::uuid, ${SOURCE}, ${siteKey(site)}, ${name.slice(0, 200)}, ${site.host}, 'connected', 'read', ${sealed},
      ${member.account.id}::uuid, now(), '{}'::jsonb, '{}'::jsonb, now())
    on conflict (store_id, source) do update set shop_domain = excluded.shop_domain, shop_name = excluded.shop_name,
      primary_domain = excluded.primary_domain, status = 'connected', scopes = 'read', access_token = excluded.access_token,
      connected_by = excluded.connected_by, connected_at = excluded.connected_at, copy = '{}'::jsonb, move = '{}'::jsonb, updated_at = now()
  `);
  await audit(member.account.id, member.store.id, "integration.woocommerce_connected", { site: siteKey(site) }, { area: "settings" }).catch((error) =>
    log("error", "woocommerce.audit_failed", { storeId: member.store.id }, error),
  );
  log("info", "woocommerce.connected", { storeId: member.store.id, root: state.root });
  return 200;
}

// ---------------------------------------------------------------------------
// Using the connection
// ---------------------------------------------------------------------------

/** The connected site and its key, for the store; null when none is connected (or the server cannot decrypt). */
async function access(storeId: string): Promise<{ site: WooSite; creds: Credentials } | null> {
  const secret = key();
  if (!secret) return null;
  const row = await typedRow(
    z.object({ shop_domain: col.text, access_token: col.text.nullable() }),
    sql`select shop_domain, access_token from commerce.shop_moves where store_id = ${storeId}::uuid and source = ${SOURCE} and status = 'connected'`,
  );
  const site = row ? siteOfKey(row.shop_domain) : null;
  if (!row?.access_token || !site) return null;
  try {
    const creds = JSON.parse(decryptSecret(row.access_token, secret)) as Partial<Credentials>;
    if (typeof creds.key !== "string" || typeof creds.secret !== "string" || (creds.root !== "wp-json" && creds.root !== "rest_route")) return null;
    return { site, creds: { key: creds.key, secret: creds.secret, root: creds.root } };
  } catch (error) {
    log("error", "woocommerce.key_unreadable", { storeId }, error);
    return null;
  }
}

export type WooPage = { ok: true; items: unknown; total: number | null; pages: number | null } | { ok: false; problem: "disconnected" | "refused" | "failed" | "too_large" };

const header = (got: Fetched, name: string): number | null => {
  if (!got.ok) return null;
  const value = got.headers?.[name];
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/**
 * One REST answer from the store's connected shop: its JSON and, for a list, WooCommerce's totals (`X-WP-Total`, `X-WP-TotalPages`). A
 * key the site no longer knows (401) is `refused`: the owner revoked it, and the page asks him to connect again.
 */
export async function wooGet(storeId: string, route: string, query: Record<string, string | number> = {}, deps: WooDeps = {}): Promise<WooPage> {
  const a = await access(storeId);
  if (!a) return { ok: false, problem: "disconnected" };
  const got = await getWith(a.site, a.creds, route, query, deps);
  if (!got.ok) {
    if (got.status === 401 || got.status === 403) return { ok: false, problem: "refused" };
    return { ok: false, problem: /larger/.test(got.problem) ? "too_large" : "failed" };
  }
  try {
    return { ok: true, items: JSON.parse(text(got)) as unknown, total: header(got, "x-wp-total"), pages: header(got, "x-wp-totalpages") };
  } catch {
    return { ok: false, problem: "failed" };
  }
}

/** A setting of WooCommerce's (`wc/v3/settings/{group}/{id}`): its value, or null. */
export async function wooSetting(storeId: string, group: string, id: string, deps: WooDeps = {}): Promise<string | null> {
  const got = await wooGet(storeId, `wc/v3/settings/${group}/${id}`, {}, deps);
  const value = got.ok && got.items && typeof got.items === "object" ? (got.items as Record<string, unknown>).value : null;
  return typeof value === "string" ? value.slice(0, 200) : null;
}

// ---------------------------------------------------------------------------
// What the page shows
// ---------------------------------------------------------------------------

export type WooConnection = { site: string; name: string; connectedAt: string };

/** The store's WooCommerce connection as the owner's page shows it (never the key), or null. */
export async function wooConnection(member: Membership): Promise<WooConnection | null> {
  if (!memberCan(member, OWNER)) return null;
  const row = await typedRow(
    z.object({ shop_domain: col.text, shop_name: col.text, connected_at: col.timestamp }),
    sql`select shop_domain, shop_name, connected_at from commerce.shop_moves where store_id = ${member.store.id}::uuid and source = ${SOURCE} and status = 'connected'`,
  );
  return row ? { site: row.shop_domain, name: row.shop_name, connectedAt: row.connected_at } : null;
}

/**
 * *Disconnect* (owner only): the key forgotten here. WooCommerce has no route to delete a key from outside, so the page says where the owner
 * removes it on his site (WooCommerce → Settings → Advanced → REST API). Audited.
 */
export async function disconnectWoo(member: Membership): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  const rows = await db().execute(sql`
    update commerce.shop_moves set status = 'disconnected', access_token = null, mover_secret = null, updated_at = now()
     where store_id = ${member.store.id}::uuid and source = ${SOURCE} and status = 'connected' returning store_id
  `);
  if (rows.length > 0)
    await audit(member.account.id, member.store.id, "integration.woocommerce_disconnected", {}, { area: "settings" }).catch((error) =>
      log("error", "woocommerce.audit_failed", { storeId: member.store.id }, error),
    );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The mover: our WordPress plugin's read-only routes (D446 step 2)
// ---------------------------------------------------------------------------

/**
 * *Connect the plugin* (owner only, the shop connected): the plugin's own page on the owner's site, with a note sealed here. The owner presses
 * Allow there; the plugin then posts its secret to `/api/woocommerce/mover` (`finishMoverConnect()`).
 */
export async function startMoverConnect(member: Membership, deps: WooDeps = {}): Promise<{ ok: true; url: string } | { ok: false; problem: "off" | "forbidden" | "disconnected" }> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "forbidden" };
  const secret = key();
  if (!secret) return { ok: false, problem: "off" };
  const a = await access(member.store.id);
  if (!a) return { ok: false, problem: "disconnected" };
  const note = sealMoverState(secret, { nonce: random(), store: member.store.slug, account: member.account.id, site: siteKey(a.site) }, deps.now);
  return { ok: true, url: `https://${siteKey(a.site)}/wp-admin/admin.php?${new URLSearchParams({ page: "kaizen-store-mover", note })}` };
}

/** One signed call to the plugin's route, with a given secret. */
async function moverCall(site: WooSite, root: RestRoot, secret: string, route: MoverRoute, query: Record<string, string | number>, deps: WooDeps): Promise<Fetched> {
  const time = Math.floor((deps.now ?? Date.now()) / 1000);
  return openUrl(deps)(restUrl(site, root, `${MOVER_NAMESPACE}/${route}`, query), moverHeaders(secret, time, `/${MOVER_NAMESPACE}/${route}`, query));
}

/**
 * The plugin's post to `/api/woocommerce/mover` (answers the HTTP status and, on success, where the owner's browser goes next): the note
 * checked (signed here, not over), the owner still the store's owner, the shop still connected at the same site, and the secret tried once
 * with a signed call before it is kept, encrypted.
 */
export async function finishMoverConnect(body: unknown, deps: WooDeps = {}): Promise<{ status: number; back?: string }> {
  const key_ = key();
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const state = key_ ? openMoverState(key_, b.note, deps.now) : null;
  if (!key_ || !state || !isMoverSecret(b.secret)) return { status: 400 };
  const member = await passMembership(state.store, state.account);
  if (!member || !memberCan(member, OWNER)) return { status: 403 };
  const a = await access(member.store.id);
  if (!a || siteKey(a.site) !== state.site) return { status: 409 };
  const tried = await moverCall(a.site, a.creds.root, b.secret, "plugins", {}, deps);
  if (!tried.ok) {
    log("warn", "woocommerce.mover_refused", { storeId: member.store.id, status: tried.status ?? null });
    return { status: 400 };
  }
  await db().execute(sql`
    update commerce.shop_moves set mover_secret = ${encryptSecret(b.secret, key_)}, updated_at = now()
     where store_id = ${member.store.id}::uuid and source = ${SOURCE} and status = 'connected'
  `);
  await audit(member.account.id, member.store.id, "integration.woocommerce_mover_connected", { site: state.site }, { area: "settings" }).catch((error) =>
    log("error", "woocommerce.audit_failed", { storeId: member.store.id }, error),
  );
  log("info", "woocommerce.mover_connected", { storeId: member.store.id });
  return { status: 200, back: `${siteUrl()}/admin/${member.store.slug}/settings/moving?mover=connected` };
}

/** Whether the plugin reads for this store. */
export const hasMover = async (storeId: string): Promise<boolean> => (await moverSecretOf(storeId)) !== null;

/** The plugin's secret for the store, when the plugin is connected. */
async function moverSecretOf(storeId: string): Promise<string | null> {
  const k = key();
  if (!k) return null;
  const row = await typedRow(
    z.object({ mover_secret: col.text.nullable() }),
    sql`select mover_secret from commerce.shop_moves where store_id = ${storeId}::uuid and source = ${SOURCE} and status = 'connected'`,
  );
  if (!row?.mover_secret) return null;
  try {
    return decryptSecret(row.mover_secret, k);
  } catch (error) {
    log("error", "woocommerce.mover_unreadable", { storeId }, error);
    return null;
  }
}

export type MoverAnswer = { ok: true; data: unknown } | { ok: false; problem: "none" | "refused" | "failed" };

/** One of the plugin's routes, signed: `none` when the plugin is not connected, `refused` when the site no longer takes the secret. */
export async function moverGet(storeId: string, route: MoverRoute, query: Record<string, string | number> = {}, deps: WooDeps = {}): Promise<MoverAnswer> {
  const [a, secret] = await Promise.all([access(storeId), moverSecretOf(storeId)]);
  if (!a || !secret) return { ok: false, problem: "none" };
  const got = await moverCall(a.site, a.creds.root, secret, route, query, deps);
  if (!got.ok) return { ok: false, problem: got.status === 401 || got.status === 403 ? "refused" : "failed" };
  try {
    return { ok: true, data: JSON.parse(text(got)) as unknown };
  } catch {
    return { ok: false, problem: "failed" };
  }
}

/** Whether the plugin reads for this store (owner only), and the plugins it says the shop runs; null without a connected shop. */
export async function moverStatus(member: Membership, deps: WooDeps = {}): Promise<{ connected: false } | { connected: true; plugins: ShopPlugin[] | null } | null> {
  if (!memberCan(member, OWNER) || !(await access(member.store.id))) return null;
  if (!(await moverSecretOf(member.store.id))) return { connected: false };
  const got = await moverGet(member.store.id, "plugins", {}, deps);
  return { connected: true, plugins: got.ok ? pluginsOf(got.data) : null };
}

/** *Stop the plugin reading* (owner only): the secret forgotten here; the plugin's own *Stop Kaizena Flow reading* forgets it there. */
export async function disconnectMover(member: Membership): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  await db().execute(sql`update commerce.shop_moves set mover_secret = null, updated_at = now() where store_id = ${member.store.id}::uuid and source = ${SOURCE}`);
  await audit(member.account.id, member.store.id, "integration.woocommerce_mover_disconnected", {}, { area: "settings" }).catch((error) =>
    log("error", "woocommerce.audit_failed", { storeId: member.store.id }, error),
  );
  return { ok: true };
}
