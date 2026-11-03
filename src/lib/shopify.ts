/**
 * Kaizena Flow's Shopify app (D445 step 2, `docs/moving-from-shopify.md` 2.3, 4.2, 10), pure: the API version and the scopes it asks for
 * (read only, never a `write_`), the shop's `myshopify.com` name found from whatever the owner typed, the checks Shopify asks of an app (the
 * callback's HMAC over its query, a webhook's over its body, the shop's name anchored at both ends), the state that ties Shopify's answer
 * to the browser and the owner who pressed *Connect Shopify*, and the authorize address. Read on 3 November 2026 from
 * <https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant> and
 * <https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance>.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SHOPIFY_API_VERSION = "2026-10";

/** What the app may read. Never a `write_` scope: a move reads Shopify and writes nothing there. */
export const SHOPIFY_SCOPES: readonly string[] = [
  "read_products",
  "read_inventory",
  "read_locations",
  "read_customers",
  "read_orders",
  "read_content",
  "read_online_store_navigation",
  "read_discounts",
  "read_price_rules",
  "read_gift_cards",
  "read_shipping",
  "read_markets",
  "read_themes",
];

/** The scopes asked for: `read_all_orders` only once Shopify has approved it for the app (`SHOPIFY_ALL_ORDERS=1`). */
export const scopesFor = (allOrders: boolean): string[] => (allOrders ? [...SHOPIFY_SCOPES, "read_all_orders"] : [...SHOPIFY_SCOPES]);

/** The scopes asked for that the shop did not grant (a `write_` grant includes its `read_`). */
export function missingScopes(asked: readonly string[], granted: string): string[] {
  const have = new Set(
    granted
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((s) => (s.startsWith("write_") ? [s, `read_${s.slice(6)}`] : [s])),
  );
  return asked.filter((s) => !have.has(s));
}

// ---------------------------------------------------------------------------
// The shop
// ---------------------------------------------------------------------------

/** A shop's own name at Shopify, anchored at both ends as Shopify says. */
export const MYSHOPIFY = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
export const isMyshopify = (value: unknown): value is string => typeof value === "string" && value.length <= 120 && MYSHOPIFY.test(value);

export type ShopInput = { shop: string } | { host: string } | null;

/**
 * What the owner typed, read: a `myshopify.com` name (`myshop`, `myshop.myshopify.com`, an address on it), Shopify's admin address
 * (`admin.shopify.com/store/myshop`), or another host whose shop is found by asking it (`myshop.com`). Null when it is no address.
 */
export function readShopInput(raw: string): ShopInput {
  const text = String(raw ?? "").trim();
  if (text === "" || text.length > 300 || /\s/.test(text)) return null;
  // A bare word is the shop's handle, as Shopify's own login form takes it.
  if (/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(text) && !text.includes(".")) return { shop: `${text.toLowerCase()}.myshopify.com` };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host.length <= 120 && MYSHOPIFY.test(host)) return { shop: host };
  if (host === "admin.shopify.com") {
    const handle = /^\/store\/([a-zA-Z0-9][a-zA-Z0-9-]*)(?:\/|$)/.exec(url.pathname)?.[1];
    return handle ? { shop: `${handle.toLowerCase()}.myshopify.com` } : null;
  }
  if (!host.includes(".")) return null;
  return { host };
}

/** The shop's `myshopify.com` name from its public `/meta.json` (every Shopify storefront answers it), or null. */
export function shopFromMeta(text: string): string | null {
  try {
    const value = (JSON.parse(text) as { myshopify_domain?: unknown }).myshopify_domain;
    return isMyshopify(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The same from a storefront page (`Shopify.shop = "myshop.myshopify.com";`), or null. */
export function shopFromHtml(html: string): string | null {
  const found = /Shopify\.shop\s*=\s*["']([a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com)["']/.exec(html.slice(0, 400_000))?.[1];
  return found ? found.toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Shopify's checks
// ---------------------------------------------------------------------------

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Whether a request Shopify sent to the app's address carries Shopify's HMAC: every parameter but `hmac` (and the older `signature`),
 * sorted by name, joined as `name=value` with `&`, signed with HMAC-SHA256 under the app's secret, in hex.
 */
export function queryHmacOk(params: URLSearchParams, secret: string): boolean {
  const given = params.get("hmac");
  if (!given || !/^[0-9a-f]{64}$/i.test(given)) return false;
  const message = [...params.entries()]
    .filter(([name]) => name !== "hmac" && name !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return sameText(createHmac("sha256", secret).update(message).digest("hex"), given.toLowerCase());
}

/** Whether a webhook's body carries Shopify's `X-Shopify-Hmac-Sha256`: HMAC-SHA256 of the raw body under the app's secret, in base64. */
export function webhookHmacOk(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || header.length > 100) return false;
  return sameText(createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"), header);
}

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

export const SHOPIFY_STATE_COOKIE = "kaizen_shopify";
export const SHOPIFY_STATE_PATH = "/api/shopify";
export const SHOPIFY_STATE_MINUTES = 15;

/** What the state cookie holds, signed: the nonce Shopify hands back, which store and which account pressed Connect, and for which shop. */
export type ShopifyState = { state: string; store: string; account: string; shop: string; expires: number };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:shopify-connect").digest();
const sign = (secret: Buffer, body: string) => createHmac("sha256", derive(secret)).update(body).digest("base64url");

export function sealShopifyState(secret: Buffer, value: Omit<ShopifyState, "expires">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, expires: now + SHOPIFY_STATE_MINUTES * 60_000 })).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** The state cookie's contents, or null when it is not one this server signed, is altered, malformed or over. */
export function openShopifyState(secret: Buffer, sealed: string | null | undefined, now = Date.now()): ShopifyState | null {
  if (typeof sealed !== "string" || sealed.length > 2000) return null;
  const [body, given, ...rest] = sealed.split(".");
  if (!body || !given || rest.length > 0 || !sameText(sign(secret, body), given)) return null;
  let value: Partial<ShopifyState>;
  try {
    value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ShopifyState>;
  } catch {
    return null;
  }
  const { state, store, account, shop, expires } = value;
  if (typeof state !== "string" || !NONCE.test(state)) return null;
  if (typeof store !== "string" || !SLUG.test(store) || typeof account !== "string" || !UUID.test(account) || !isMyshopify(shop)) return null;
  if (typeof expires !== "number" || expires <= now || expires - now > SHOPIFY_STATE_MINUTES * 60_000) return null;
  return { state, store, account, shop, expires };
}

/** Shopify's page where the owner approves the app for the shop. */
export function shopifyAuthorizeUrl(o: { shop: string; clientId: string; scopes: readonly string[]; redirectUri: string; state: string }): string {
  const query = new URLSearchParams({ client_id: o.clientId, scope: o.scopes.join(","), redirect_uri: o.redirectUri, state: o.state });
  return `https://${o.shop}/admin/oauth/authorize?${query}`;
}

/** Whether a token's time is up, a minute early so a call never starts with a token that ends on the way. */
export const tokenDue = (expiresAt: Date | null, now = Date.now()): boolean => expiresAt !== null && expiresAt.getTime() - 60_000 <= now;
