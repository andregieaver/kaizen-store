import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { shopifyEnv } from "@/lib/env";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/secret-box";
import {
  SHOPIFY_API_VERSION,
  isMyshopify,
  missingScopes,
  openShopifyState,
  queryHmacOk,
  readShopInput,
  scopesFor,
  sealShopifyState,
  shopFromHtml,
  shopFromMeta,
  shopifyAuthorizeUrl,
  tokenDue,
  webhookHmacOk,
} from "@/lib/shopify";
import { siteUrl } from "@/lib/site";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { checkPermission, memberCan } from "./permissions";
import { safeFetch, type Fetched } from "./replicate-fetch";

type Row = Record<string, unknown>;

/**
 * Connecting a store to the Shopify shop it moves from (D445 step 2, `docs/moving-from-shopify.md` 4.2, 10): Kaizena Flow's own Shopify
 * app, read-only, through Shopify's authorization code grant with an expiring offline token and its refresh token. The owner types any
 * address of the shop (found through its public `/meta.json`, else its page), presses *Connect Shopify*, approves on Shopify's own page,
 * and comes back connected. The tokens are encrypted in `commerce.shop_moves` (this module is its only writer) and leave it only in the
 * header of a call to that shop. Shopify's webhooks (`app/uninstalled` and the three privacy topics) are answered here too. The owner's
 * alone. Off until the app's id and secret are set (`shopifyEnv()`) and the server can encrypt (`SETTINGS_ENCRYPTION_KEY`). The tests give
 * `fetch` (`ShopifyDeps`); Shopify's addresses are built only from a name `isMyshopify()` passed.
 */

export type ShopifyDeps = {
  fetch?: typeof fetch;
  now?: number;
  open?: (url: string) => Promise<Fetched>;
  /** Who is signed in now as the store's owner (the request's session by default). */
  owner?: (storeSlug: string) => Promise<Membership | null>;
};

const OWNER = "owner" as const;
const SOURCE = "shopify";

const random = () => randomBytes(32).toString("base64url");
export const shopifyRedirectUri = (): string => `${siteUrl()}/api/shopify/callback`;

function client(): { clientId: string; clientSecret: string; allOrders: boolean; key: Buffer } | null {
  let env: ReturnType<typeof shopifyEnv>;
  try {
    env = shopifyEnv();
  } catch (error) {
    log("error", "shopify.misconfigured", {}, error);
    return null;
  }
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
  return env && key ? { ...env, key } : null;
}

/** Whether *Connect Shopify* can work on this server. */
export const shopifyOffered = (): boolean => client() !== null;

// ---------------------------------------------------------------------------
// Finding the shop
// ---------------------------------------------------------------------------

export type FindProblem = "address" | "not_shopify" | "unreachable";
export type Found = { ok: true; shop: string } | { ok: false; problem: FindProblem };

/** The shop's `myshopify.com` name from whatever the owner typed: as it is, or asked of the shop's own address (`/meta.json`, then its page). */
export async function findShopifyShop(raw: string, deps: ShopifyDeps = {}): Promise<Found> {
  const input = readShopInput(raw);
  if (input === null) return { ok: false, problem: "address" };
  if ("shop" in input) return { ok: true, shop: input.shop };
  const open = deps.open ?? ((url: string) => safeFetch(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000, maxRedirects: 5 }));
  const meta = await open(`https://${input.host}/meta.json`);
  const fromMeta = meta.ok ? shopFromMeta(Buffer.from(meta.bytes).toString("utf8")) : null;
  if (fromMeta) return { ok: true, shop: fromMeta };
  const page = await open(`https://${input.host}/`);
  const fromPage = page.ok ? shopFromHtml(Buffer.from(page.bytes).toString("utf8")) : null;
  if (fromPage) return { ok: true, shop: fromPage };
  return { ok: false, problem: !meta.ok && !page.ok && meta.status === undefined && page.status === undefined ? "unreachable" : "not_shopify" };
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

export type StartProblem = FindProblem | "off" | "forbidden" | "other_shop";
export type ShopifyStart = { ok: true; url: string; cookie: string } | { ok: false; problem: StartProblem };

/** The press (owner only): the shop found, a fresh nonce sealed with the store, the account and the shop for the cookie, and Shopify's page. */
export async function startShopifyConnect(member: Membership, raw: string, deps: ShopifyDeps = {}): Promise<ShopifyStart> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "forbidden" };
  const c = client();
  if (!c) return { ok: false, problem: "off" };
  // A store moves from one shop at a time (D446): a connected WooCommerce shop is disconnected first.
  const [other] = await db().execute<Row>(sql`select 1 from commerce.shop_moves where store_id = ${member.store.id}::uuid and source <> ${SOURCE} and status = 'connected'`);
  if (other) return { ok: false, problem: "other_shop" };
  const found = await findShopifyShop(raw, deps);
  if (!found.ok) return found;
  const value = { state: random(), store: member.store.slug, account: member.account.id, shop: found.shop };
  return {
    ok: true,
    cookie: sealShopifyState(c.key, value, deps.now),
    url: shopifyAuthorizeUrl({ shop: found.shop, clientId: c.clientId, scopes: scopesFor(c.allOrders), redirectUri: shopifyRedirectUri(), state: value.state }),
  };
}

type Tokens = { access: string; scope: string; accessExpiresAt: Date | null; refresh: string | null; refreshExpiresAt: Date | null };

const tokensOf = (body: Row, now: number): Tokens | null => {
  if (typeof body.access_token !== "string" || body.access_token === "" || body.access_token.length > 500) return null;
  const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(now + v * 1000) : null);
  return {
    access: body.access_token,
    scope: typeof body.scope === "string" ? body.scope.slice(0, 2000) : "",
    accessExpiresAt: seconds(body.expires_in),
    refresh: typeof body.refresh_token === "string" && body.refresh_token !== "" ? body.refresh_token.slice(0, 500) : null,
    refreshExpiresAt: seconds(body.refresh_token_expires_in),
  };
};

/** Shopify's token endpoint: the code for a token (with `expiring=1`), or a refresh token for a new pair. Null on any refusal. */
async function tokenCall(shop: string, form: Record<string, string>, deps: ShopifyDeps): Promise<{ status: number; tokens: Tokens | null }> {
  const call = deps.fetch ?? fetch;
  try {
    const response = await call(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as Row;
    return { status: response.status, tokens: response.ok ? tokensOf(body, deps.now ?? Date.now()) : null };
  } catch (error) {
    log("warn", "shopify.token_call_failed", {}, error);
    return { status: 0, tokens: null };
  }
}

/** One GraphQL call with a token. */
async function graphqlWith<T>(shop: string, token: string, query: string, variables: Record<string, unknown>, deps: ShopifyDeps): Promise<{ status: number; data: T | null }> {
  const call = deps.fetch ?? fetch;
  try {
    const response = await call(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { status: response.status, data: null };
    const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: unknown };
    if (body.errors) log("warn", "shopify.graphql_errors", { status: response.status });
    return { status: response.status, data: body.data ?? null };
  } catch (error) {
    log("warn", "shopify.graphql_failed", {}, error);
    return { status: 0, data: null };
  }
}

const SHOP_QUERY = `query KaizenShop { shop { name myshopifyDomain primaryDomain { host } } }`;
type ShopAnswer = { shop?: { name?: string; myshopifyDomain?: string; primaryDomain?: { host?: string } | null } };

export type ConnectOutcome = "connected" | "declined" | "failed" | "off";

/**
 * Shopify's return to `/api/shopify/callback`: the state checked against the cookie, Shopify's HMAC over the query, the shop's name
 * (anchored, and the one the owner chose), the owner signed in now the one who pressed; then the code exchanged, the shop's name and address
 * read, and the tokens kept encrypted. The answer is the admin page to go back to, with what became of it.
 */
export async function finishShopifyConnect(params: URLSearchParams, cookie: string | undefined, deps: ShopifyDeps = {}): Promise<string> {
  const c = client();
  const state = c ? openShopifyState(c.key, cookie, deps.now) : null;
  if (!c || !state) return "/admin";
  const back = (outcome: ConnectOutcome) => `/admin/${state.store}/settings/moving?shopify=${outcome}`;
  if (params.get("state") !== state.state || !queryHmacOk(params, c.clientSecret)) return back("failed");
  const shop = params.get("shop")?.toLowerCase() ?? "";
  if (!isMyshopify(shop) || shop !== state.shop) return back("failed");
  if (params.get("error")) return back("declined");
  const code = params.get("code");
  if (!code || code.length > 500) return back("failed");
  const member = await (deps.owner ?? ((slug: string) => checkPermission(slug, OWNER)))(state.store);
  if (!member || member.account.id !== state.account) return back("failed");
  const exchanged = await tokenCall(shop, { client_id: c.clientId, client_secret: c.clientSecret, code, expiring: "1" }, deps);
  if (!exchanged.tokens) {
    log("warn", "shopify.code_refused", { storeId: member.store.id, status: exchanged.status });
    return back("failed");
  }
  const t = exchanged.tokens;
  const info = (await graphqlWith<ShopAnswer>(shop, t.access, SHOP_QUERY, {}, deps)).data?.shop;
  const name = String(info?.name ?? "").slice(0, 200);
  const primary = typeof info?.primaryDomain?.host === "string" && /^[a-z0-9.-]{1,255}$/i.test(info.primaryDomain.host) ? info.primaryDomain.host.toLowerCase() : null;
  await db().execute(sql`
    insert into commerce.shop_moves (store_id, source, shop_domain, shop_name, primary_domain, status, scopes, access_token, access_expires_at,
      refresh_token, refresh_expires_at, connected_by, connected_at, updated_at)
    values (${member.store.id}::uuid, ${SOURCE}, ${shop}, ${name}, ${primary}, 'connected', ${t.scope}, ${encryptSecret(t.access, c.key)},
      ${t.accessExpiresAt?.toISOString() ?? null}::timestamptz, ${t.refresh ? encryptSecret(t.refresh, c.key) : null},
      ${t.refreshExpiresAt?.toISOString() ?? null}::timestamptz, ${member.account.id}::uuid, now(), now())
    on conflict (store_id, source) do update set shop_domain = excluded.shop_domain, shop_name = excluded.shop_name,
      primary_domain = excluded.primary_domain, status = 'connected', scopes = excluded.scopes, access_token = excluded.access_token,
      access_expires_at = excluded.access_expires_at, refresh_token = excluded.refresh_token, refresh_expires_at = excluded.refresh_expires_at,
      connected_by = excluded.connected_by, connected_at = excluded.connected_at, updated_at = now()
  `);
  const missing = missingScopes(scopesFor(c.allOrders), t.scope);
  await audit(member.account.id, member.store.id, "integration.shopify_connected", { shop, missing }, { area: "settings" }).catch((error) =>
    log("error", "shopify.audit_failed", { storeId: member.store.id }, error),
  );
  log("info", "shopify.connected", { storeId: member.store.id, missing: missing.length, expiring: t.accessExpiresAt !== null });
  return back("connected");
}

// ---------------------------------------------------------------------------
// Using the connection
// ---------------------------------------------------------------------------

/** Clears a connection's tokens: Shopify said the app is gone, the refresh token is over, or the owner disconnected. */
async function dropTokens(where: ReturnType<typeof sql>): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.shop_moves set status = 'disconnected', access_token = null, access_expires_at = null, refresh_token = null,
      refresh_expires_at = null, updated_at = now()
    where source = ${SOURCE} and ${where} returning store_id
  `);
  return rows.length;
}

/**
 * The shop and a token that works now, for a store that is connected: an expiring token is refreshed a minute before its end, under the
 * row's lock so two calls never spend one refresh token. A refresh Shopify refuses (the refresh token is over or revoked) disconnects.
 */
export async function shopifyAccess(storeId: string, deps: ShopifyDeps = {}): Promise<{ shop: string; token: string } | null> {
  const c = client();
  if (!c) return null;
  const now = deps.now ?? Date.now();
  return db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      select shop_domain, access_token, access_expires_at, refresh_token from commerce.shop_moves
       where store_id = ${storeId}::uuid and source = ${SOURCE} and status = 'connected' for update
    `);
    if (!row || typeof row.access_token !== "string") return null;
    const shop = String(row.shop_domain);
    const expires = row.access_expires_at ? new Date(String(row.access_expires_at)) : null;
    if (!tokenDue(expires, now)) return { shop, token: decryptSecret(row.access_token, c.key) };
    if (typeof row.refresh_token !== "string") return null;
    const refreshed = await tokenCall(shop, { client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token", refresh_token: decryptSecret(row.refresh_token, c.key) }, deps);
    if (!refreshed.tokens) {
      if (refreshed.status === 400 || refreshed.status === 401) {
        await tx.execute(sql`
          update commerce.shop_moves set status = 'disconnected', access_token = null, access_expires_at = null, refresh_token = null,
            refresh_expires_at = null, updated_at = now() where store_id = ${storeId}::uuid and source = ${SOURCE}
        `);
        log("warn", "shopify.refresh_refused", { storeId, status: refreshed.status });
      }
      return null;
    }
    const t = refreshed.tokens;
    await tx.execute(sql`
      update commerce.shop_moves set access_token = ${encryptSecret(t.access, c.key)}, access_expires_at = ${t.accessExpiresAt?.toISOString() ?? null}::timestamptz,
        refresh_token = ${t.refresh ? encryptSecret(t.refresh, c.key) : row.refresh_token}, refresh_expires_at = coalesce(${t.refreshExpiresAt?.toISOString() ?? null}::timestamptz, refresh_expires_at),
        updated_at = now()
      where store_id = ${storeId}::uuid and source = ${SOURCE}
    `);
    return { shop, token: t.access };
  });
}

export type ShopifyCall<T> = { ok: true; data: T } | { ok: false; problem: "disconnected" | "failed" };

/** A GraphQL query against the store's connected shop. A 401 means the app is gone from the shop: the connection is dropped. */
export async function shopifyGraphql<T>(storeId: string, query: string, variables: Record<string, unknown> = {}, deps: ShopifyDeps = {}): Promise<ShopifyCall<T>> {
  const access = await shopifyAccess(storeId, deps);
  if (!access) return { ok: false, problem: "disconnected" };
  const answer = await graphqlWith<T>(access.shop, access.token, query, variables, deps);
  if (answer.status === 401) {
    await dropTokens(sql`store_id = ${storeId}::uuid`);
    return { ok: false, problem: "disconnected" };
  }
  return answer.data === null ? { ok: false, problem: "failed" } : { ok: true, data: answer.data };
}

// ---------------------------------------------------------------------------
// What the page shows
// ---------------------------------------------------------------------------

export type ShopifyConnection = { shop: string; name: string; primaryDomain: string | null; connectedAt: string; missing: string[] };

/** The store's connection as the owner's page shows it (never a token), or null when there is none or the member is not the owner. */
export async function shopifyConnection(member: Membership): Promise<ShopifyConnection | null> {
  if (!memberCan(member, OWNER)) return null;
  const [row] = await db().execute<Row>(sql`
    select shop_domain, shop_name, primary_domain, scopes, connected_at from commerce.shop_moves
     where store_id = ${member.store.id}::uuid and source = ${SOURCE} and status = 'connected'
  `);
  if (!row) return null;
  return {
    shop: String(row.shop_domain),
    name: String(row.shop_name ?? ""),
    primaryDomain: row.primary_domain === null ? null : String(row.primary_domain),
    connectedAt: new Date(String(row.connected_at)).toISOString(),
    missing: missingScopes(scopesFor(client()?.allOrders ?? false), String(row.scopes ?? "")),
  };
}

/**
 * *Disconnect* (owner only): the app's grant revoked at Shopify where it still answers (`DELETE /admin/api_permissions/current.json`,
 * best effort), and the tokens dropped here whatever Shopify said. Audited.
 */
export async function disconnectShopify(member: Membership, deps: ShopifyDeps = {}): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  const access = await shopifyAccess(member.store.id, deps).catch(() => null);
  if (access) {
    const call = deps.fetch ?? fetch;
    await call(`https://${access.shop}/admin/api_permissions/current.json`, { method: "DELETE", headers: { "X-Shopify-Access-Token": access.token }, signal: AbortSignal.timeout(15_000) }).catch((error) =>
      log("warn", "shopify.revoke_failed", { storeId: member.store.id }, error),
    );
  }
  const dropped = await dropTokens(sql`store_id = ${member.store.id}::uuid`);
  if (dropped > 0)
    await audit(member.account.id, member.store.id, "integration.shopify_disconnected", { shop: access?.shop ?? null }, { area: "settings" }).catch((error) =>
      log("error", "shopify.audit_failed", { storeId: member.store.id }, error),
    );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Shopify's webhooks
// ---------------------------------------------------------------------------

export const SHOPIFY_WEBHOOK_TOPICS = ["app/uninstalled", "shop/redact", "customers/redact", "customers/data_request"] as const;

/**
 * A webhook from Shopify to `/api/shopify/webhooks` (answers the HTTP status): 401 without Shopify's HMAC over the raw body, as Shopify
 * requires. `app/uninstalled` disconnects every store connected to the shop; `shop/redact` (48 hours after) deletes their rows;
 * `customers/redact` and `customers/data_request` find nothing of the customer kept by the connection (a copied customer is the store's
 * own, under the store's own privacy tools, D162), and are logged by topic and count only.
 */
export async function handleShopifyWebhook(rawBody: string, headers: { hmac: string | null; topic: string | null; shop: string | null }): Promise<number> {
  const env = (() => {
    try {
      return shopifyEnv();
    } catch {
      return null;
    }
  })();
  if (!env) return 401;
  if (!webhookHmacOk(rawBody, headers.hmac, env.clientSecret)) return 401;
  const shop = headers.shop?.toLowerCase() ?? "";
  if (!isMyshopify(shop)) return 200;
  switch (headers.topic) {
    case "app/uninstalled": {
      const n = await dropTokens(sql`shop_domain = ${shop}`);
      log("info", "shopify.uninstalled", { stores: n });
      return 200;
    }
    case "shop/redact": {
      const rows = await db().execute<Row>(sql`delete from commerce.shop_moves where source = ${SOURCE} and shop_domain = ${shop} returning store_id`);
      log("info", "shopify.shop_redacted", { stores: rows.length });
      return 200;
    }
    case "customers/redact":
    case "customers/data_request":
      log("info", "shopify.customer_request", { topic: headers.topic });
      return 200;
    default:
      return 200;
  }
}
